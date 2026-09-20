import { randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  circleIdentity,
  claimLink,
  createLink,
  passwordPrincipal,
  readLink,
  saveLogin,
  loginAvailable,
  digest,
} from "@/server/circle/access";
import {
  CircleError,
  readCircle,
  updateCircle,
  withCircleDb,
  limit,
} from "@/server/circle/store";
import { uploadPhotos, reanalyze, mediaFolder } from "@/server/circle/photos";
import { publicBase, sendText } from "@/server/circle/messages";
import { transcribeAudio } from "@/server/circle/ai";
import { discardAudio, expireAudioDrafts } from "@/server/circle/audio";
import { deleteCollectionItem, deleteStory } from "@/server/circle/delete";
import { askFamilyGraph, familyQueryRevision } from "@/server/circle/graph-query";
import { loadSampleFamily, sampleFamilyConnections } from "@/server/circle/sample";
import { editPeople, faceThumbnail, getPeople, saveFaceScan } from "@/server/circle/people";
import { sameOrigin, sessionCookie, browserPrincipal } from "@/server/session";
import { getOnboarding, newInvitationToken } from "@/server/onboarding";
import { accountForMember, issueAccount, revokeAccount } from "@/server/accounts";
import { OnboardingError } from "@/lib/onboarding/types";
import { openSampleFamily, requireLocalSample, samplePatient, SAMPLE_PATIENT_COOKIE } from "@/server/sample-access";
import { prepareSampleCall, sampleCallRunning, syncSampleSharedMemories, visibleSampleStories } from "@/server/sample-call";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;
const noStore = { "Cache-Control": "no-store" };
const reply = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: noStore });
const str = (v: unknown, max = 500) =>
  typeof v === "string" ? v.slice(0, max).trim() : "";
type Context = { params: Promise<{ path: string[] }> };
async function handle(request: Request, context: Context): Promise<Response> {
  try {
    const parts = (await context.params).path,
      action = parts[0] || "",
      isPost = request.method === "POST";
    if (isPost && !sameOrigin(request))
      throw new CircleError("Open this action from Recall.", 403);
    const body =
      isPost && !["photos", "audio"].includes(action)
        ? await request.json().catch(() => null)
        : null;
    if (action === "login" && isPost) {
      const p = await passwordPrincipal(
        str(body?.email, 254),
        typeof body?.password === "string" ? body.password : "",
      );
      return Response.json(
        { ok: true, role: p.role },
        { headers: { ...noStore, "Set-Cookie": sessionCookie(p, request) } },
      );
    }
    if (action === "link" && isPost) {
      const token = str(body?.token);
      let link;
      try {
        link = readLink(token);
      } catch (error) {
        const principal = browserPrincipal(request);
        const existing = withCircleDb((db) =>
          db
            .prepare(
              "SELECT member,role,destination,name,used FROM links WHERE hash=?",
            )
            .get(digest(token)),
        ) as
          | {
              member: string;
              role: string;
              destination: string;
              name: string;
              used: number;
            }
          | undefined;
        if (
          principal &&
          existing?.used &&
          existing.member === principal.member_id &&
          existing.role === principal.role
        )
          return reply({
            alreadyJoined: true,
            destination: existing.destination,
            name: existing.name,
          });
        throw error;
      }
      if (!body?.accept) {
        const contact = link.member ? withCircleDb((db) => db.prepare("SELECT reminders FROM contacts WHERE member=? AND household=?").get(link.member!, link.household)) as { reminders: number } | undefined : undefined;
        return reply({
          name: link.name,
          role: link.role,
          canReceiveReminders: !!link.phone,
          reminders: contact?.reminders === 1,
        });
      }
      const claimed = await claimLink(token, typeof body?.reminders === "boolean" ? body.reminders : undefined);
      return Response.json(
        { destination: claimed.destination },
        {
          headers: {
            ...noStore,
            "Set-Cookie": sessionCookie(claimed.principal, request),
          },
        },
      );
    }
    if (action === "phone-sign-in" && isPost) {
      const phone = str(body?.phone, 30).replace(/[\s()-]/g, "");
      if (!/^\+[1-9]\d{7,14}$/.test(phone))
        throw new CircleError("Include your country code.");
      limit("phone:" + digest(phone), 3);
      const contact = withCircleDb((db) =>
        db
          .prepare("SELECT member,household FROM contacts WHERE phone=?")
          .get(phone),
      ) as { member: string; household: string } | undefined;
      if (contact && accountForMember(contact.member)?.household_id === contact.household) {
        const person = (await getOnboarding().people(contact.household)).find(
          (p) => p.person_id === contact.member && !p.removed_at,
        );
        if (person) {
          const token = createLink(
            {
              household: contact.household,
              member: contact.member,
              invitation: null,
              name: person.display_name,
              phone,
              role: person.role === "participant" ? "patient" : "family",
              destination:
                person.role === "participant" ? "/revisit" : "/caregiver",
            },
            0.5,
          );
          await sendText(
            phone,
            `Your private Recall sign-in link. It expires in 30 minutes:\n${publicBase()}/open#${token}`,
            randomUUID(),
          );
        }
      }
      return reply({
        message:
          "If this number is connected to your family, a sign-in link is on its way.",
      });
    }
    if (action === "family-start" && isPost) {
      const input = z
        .object({
          email: z.string().trim().email().max(254),
          password: z.string().min(10).max(128),
          participant: z.object({
            display_name: z.string().trim().min(1).max(80),
            phone: z.string().regex(/^\+[1-9]\d{6,14}$/),
          }),
          caregiver: z.object({
            display_name: z.string().trim().min(1).max(80),
          }),
        })
        .parse(body);
      limit("signup-all", 10, 3600_000);
      limit("signup:" + digest(input.email.toLowerCase()), 3, 3600_000);
      if (!loginAvailable(input.email))
        throw new CircleError(
          "That email already has an account. Sign in instead.",
          409,
        );
      let cookie = "";
      const made = await getOnboarding().createHousehold({
        participant: input.participant,
        caregiver: input.caregiver,
      }, async (created) => {
        const member = created.caregiver.person_id;
        let key: string | undefined, registered = false;
        try {
          await saveLogin(member, input.email, input.password);
          registered = true;
          key = issueAccount(created.household.household_id, member, "family");
          cookie = sessionCookie({ role: "family", member_id: member }, request);
        } catch (error) {
          if (key) revokeAccount(member, key);
          if (registered) withCircleDb((db) => db.prepare("DELETE FROM logins WHERE member=? AND email=?").run(member, input.email.trim().toLowerCase()));
          throw error;
        }
      });
      return Response.json(
        {
          household: made.household,
          participant_id: made.participant.person_id,
          caregiver_id: made.caregiver.person_id,
        },
        {
          status: 201,
          headers: {
            ...noStore,
            "Set-Cookie": cookie,
          },
        },
      );
    }
    if (["demo", "demo-patient"].includes(action) && isPost) {
      requireLocalSample(request);
      const fresh = action === "demo" && body?.fresh === true;
      const priorPatient = fresh ? samplePatient(request) : null;
      if (priorPatient && sampleCallRunning(priorPatient.household_id)) throw new CircleError("End the current sample call before starting a new family demo.", 409);
      const sample = await openSampleFamily(request, { fresh });
      if (!accountForMember(sample.caregiver.person_id)) issueAccount(sample.household, sample.caregiver.person_id, "family");
      const headers = new Headers(noStore);
      headers.append("Set-Cookie", sessionCookie({ role: "family", member_id: sample.caregiver.person_id }, request));
      if (action === "demo-patient" || fresh) {
        if (!accountForMember(sample.participant.person_id)) issueAccount(sample.household, sample.participant.person_id, "patient");
        if (action === "demo-patient") await prepareSampleCall(sample.household);
        headers.append("Set-Cookie", sessionCookie({ role: "patient", member_id: sample.participant.person_id }, request, SAMPLE_PATIENT_COOKIE));
      }
      return Response.json({ ok: true }, { headers });
    }
    const identity = await circleIdentity(request),
      { household, person, people, canManage } = identity;
    if (action === "graph-query" && isPost) return reply(await askFamilyGraph(request, body));
    if (["people", "face-scan", "face"].includes(action)) {
      if (person.role === "participant") throw new CircleError("Open People from a family contributor account.", 403);
      if (action === "face" && !isPost) return new Response(await faceThumbnail(household, parts[1] || ""), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
      if (action === "people" && !isPost) return reply(getPeople(household));
      if (isPost && action !== "face") {
        limit("people:" + person.person_id, 200, 3600_000);
        return reply(action === "face-scan" ? saveFaceScan(household, body) : editPeople(household, person.person_id, canManage, body));
      }
    }
    if (["state", "audio", "media", "story"].includes(action)) await expireAudioDrafts(household);
    if (action === "state" && !isPost) {
      if (process.env.NODE_ENV === "development" && readCircle(household).demoCall) await syncSampleSharedMemories(household);
      const state = readCircle(household);
      const contacts = withCircleDb((db) =>
        db
          .prepare(
            "SELECT member,phone,reminders,next_at,error,paused FROM contacts WHERE household=?",
          )
          .all(household),
      ) as {
        member: string;
        phone: string;
        reminders: number;
        next_at: number | null;
        error: string | null;
        paused: number;
      }[];
      const invitations = withCircleDb((db) =>
        db
          .prepare(
            "SELECT hash,name,phone,role,expires FROM links WHERE household=? AND invitation IS NOT NULL AND used IS NULL AND expires>?",
          )
          .all(household, Date.now()),
      ) as Record<string, unknown>[];
      return reply({
        photos: state.photos.map(({ hash, owner, namedPeople, ...p }) => p),
        moments: state.moments,
        stories: await visibleSampleStories(household, person.person_id, state),
        graphQueryRevision: await familyQueryRevision(identity),
        imports: state.imports.slice(-8).map(({ id, at, added, duplicates, moments }) => ({ id, at, added, duplicates, moments })),
        demo: state.demo,
        ...(state.demo ? { connections: sampleFamilyConnections(state.moments) } : {}),
        member: person.person_id,
        name: person.display_name,
        personName:
          people.find((p) => p.role === "participant")?.display_name ||
          "Your family",
        household,
        canManage,
        people: people.map((p) => ({
          id: p.person_id,
          name: p.display_name,
          role: p.role,
          ...(canManage || p.person_id === person.person_id
            ? { contact: contacts.find((c) => c.member === p.person_id) }
            : {}),
        })),
        invitations: canManage
          ? invitations.map(({ hash, ...v }) => ({ ...v, id: hash }))
          : [],
        hasEmail: !!withCircleDb((db) =>
          db
            .prepare("SELECT member FROM logins WHERE member=?")
            .get(person.person_id),
        ),
        aiConnected: !!process.env.OPENAI_API_KEY,
        messagingConnected:
          !!process.env.LINQ_API_KEY && publicBase().startsWith("https://"),
      });
    }
    if (action === "media" && !isPost) {
      const id = parts[1];
      if (!/^[a-f0-9-]{36}$/.test(id || ""))
        throw new CircleError("Photo unavailable.", 404);
      const state = readCircle(household),
        photo = state.photos.find((p) => p.id === id),
        draft = state.drafts?.find(
          (d) =>
            d.id === id &&
            (d.owner === person.person_id ||
              state.stories.some(
                (s) => s.audioUrl === "/api/circle/media/" + id,
              )),
        );
      if (!photo && !draft)
        throw new CircleError(
          "This file isn’t in your family collection.",
          404,
        );
      const bytes = await readFile(
        path.join(mediaFolder(household), id + (photo ? ".jpg" : ".audio")),
      );
      return new Response(bytes, {
        headers: {
          "Content-Type": photo ? "image/jpeg" : draft!.mime,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    if (!isPost) throw new CircleError("Page not found.", 404);
    if (action === "delete") return reply(await deleteCollectionItem(household, canManage, body));
    if (action === "delete-story") return reply(await deleteStory(household, canManage, body));
    if (action === "register") {
      await saveLogin(
        person.person_id,
        str(body?.email, 254),
        typeof body?.password === "string" ? body.password : "",
      );
      return reply({ ok: true });
    }
    if (action === "photos") {
      limit("photo-import:" + household, 30, 3600_000);
      const size = Number(request.headers.get("content-length") || 0);
      if (size > 245_000_000)
        throw new CircleError("Choose a smaller photo batch.", 413);
      const form = await request.formData(),
        files = form
          .getAll("photos")
          .filter((v): v is File => v instanceof File),
        id = String(form.get("requestId") || randomUUID());
      return reply(
        await uploadPhotos(
          household,
          person.person_id,
          person.display_name,
          files,
          id,
        ),
      );
    }
    if (action === "sample") {
      return reply(await loadSampleFamily(household, person.person_id, person.display_name));
    }
    if (action === "analyze") {
      limit("photo-analysis:" + household, 30, 3600_000);
      return reply(await reanalyze(household, str(body?.momentId)));
    }
    if (action === "discard-audio") {
      const id = z.string().uuid().parse(body?.id);
      await discardAudio(household, person.person_id, id);
      return reply({ ok: true });
    }
    if (action === "audio") {
      limit("audio-upload:" + person.person_id, 30, 3600_000);
      const form = await request.formData(),
        file = form.get("audio");
      if (
        !(file instanceof File) ||
        file.size === 0 || file.size > 20_000_000 ||
        !/^audio\/(webm|wav|x-wav|ogg|mp4|x-m4a|mpeg)(;.*)?$/.test(file.type)
      )
        throw new CircleError("Choose an audio recording under 20 MB.");
      const id = randomUUID(),
        folder = mediaFolder(household);
      await mkdir(folder, { recursive: true, mode: 0o700 });
      await writeFile(
        path.join(folder, id + ".audio"),
        Buffer.from(await file.arrayBuffer()),
        { mode: 0o600 },
      );
      let text = "",
        warning = "";
      try {
        text = await transcribeAudio(file);
      } catch (e) {
        warning =
          e instanceof Error ? e.message : "Transcription is unavailable.";
      }
      updateCircle(household, (s) => {
        s.drafts ||= [];
        s.drafts.push({
          id,
          owner: person.person_id,
          mime: file.type,
          text,
          createdAt: new Date().toISOString(),
        });
      });
      return reply({ id, text, url: "/api/circle/media/" + id, warning });
    }
    if (action === "story") {
      if (typeof body?.text !== "string" || body.text.length > 6000)
        throw new CircleError("Keep each story to 6,000 characters. Your text has not been changed.");
      const text = str(body?.text, 6000),
        momentId = str(body?.momentId),
        requestId = str(body?.requestId),
        audioId = str(body?.audioId);
      if (!text || !requestId || body?.confirmed !== true)
        throw new CircleError("Review your words, then choose Save to family.");
      if (audioId && body?.audioReviewed !== true)
        throw new CircleError("Review your recording before sharing it with family.");
      return reply(
        updateCircle(household, (s) => {
          const existing = s.stories.find(
            (x) => x.owner === person.person_id && x.requestId === requestId,
          );
          if (existing) return existing;
          const moment = s.moments.find((m) => m.id === momentId);
          if (!moment)
            throw new CircleError("This moment is no longer available.", 404);
          if (
            audioId &&
            !s.drafts?.some(
              (d) => d.id === audioId && d.owner === person.person_id,
            )
          )
            throw new CircleError("Use your own recording.");
          const story = {
            id: randomUUID(),
            eventId: momentId,
            author: person.display_name,
            owner: person.person_id,
            text,
            createdAt: new Date().toISOString(),
            source: audioId ? ("voice" as const) : ("written" as const),
            requestId,
            ...(audioId ? { audioUrl: "/api/circle/media/" + audioId } : {}),
          };
          s.stories.push(story);
          moment.revision++;
          return story;
        }),
      );
    }
    if (action === "moment") {
      const parsed = z
        .object({
          id: z.string(),
          title: z.string().trim().min(1).max(100),
          people: z.array(z.string().max(80)).max(30),
          revision: z.number().int(),
          participantIds: z.array(z.string()).max(30).optional(),
        })
        .parse(body);
      return reply(
        updateCircle(household, (s) => {
          const m = s.moments.find((m) => m.id === parsed.id);
          if (!m) throw new CircleError("Moment not found.", 404);
          if (m.revision !== parsed.revision)
            throw new CircleError(
              "Someone just updated this moment. Close and reopen it to see their changes.",
              409,
            );
          if (
            parsed.participantIds?.some(
              (id) => !people.some((p) => p.person_id === id),
            )
          )
            throw new CircleError("Choose people from your family.");
          m.title = parsed.title;
          m.titleSource = "family";
          m.people = parsed.people;
          m.participantIds = parsed.participantIds || m.participantIds;
          m.revision++;
          return m;
        }),
      );
    }
    if (action === "cancel-invitation") {
      if (!canManage)
        throw new CircleError(
          "Only your family organizer can change invitations.",
          403,
        );
      withCircleDb((db) =>
        db
          .prepare(
            "UPDATE links SET expires=0 WHERE hash=? AND household=? AND invitation IS NOT NULL AND used IS NULL",
          )
          .run(str(body?.id), household),
      );
      return reply({ ok: true });
    }
    if (action === "story-link") {
      if (!canManage)
        throw new CircleError(
          "Only your family organizer can invite a story.",
          403,
        );
      const target = people.find((p) => p.person_id === body?.member),
        moment = readCircle(household).moments.find(
          (m) => m.id === body?.momentId,
        );
      if (!target || !moment)
        throw new CircleError("Choose a family member and a moment.");
      const contact = withCircleDb((db) =>
        db
          .prepare("SELECT phone FROM contacts WHERE member=? AND household=?")
          .get(target.person_id, household),
      ) as { phone: string } | undefined;
      const phone = contact?.phone || target.phone || null;
      const token = createLink({
        household,
        member: target.person_id,
        invitation: null,
        name: target.display_name,
        phone,
        role: target.role === "participant" ? "patient" : "family",
        destination: "/contribute?moment=" + encodeURIComponent(moment.id),
      });
      const base = readCircle(household).demo
          ? request.headers.get("origin")!
          : publicBase() || request.headers.get("origin")!,
        url = base + "/open#" + token;
      let sent = false,
        deliveryError = "";
      if (body?.send === true) {
        try {
          if (readCircle(household).demo)
            throw new CircleError(
              "Sample families don’t send real texts. Copy this link to try the story invitation.",
            );
          if (!phone)
            throw new CircleError(
              "No phone number is connected. Copy the link instead.",
            );
          await sendText(
            phone,
            `${person.display_name} has a photograph to share from “${moment.title}”. ${moment.question}\n\nAdd your part of the story: ${url}`,
            digest(token),
          );
          sent = true;
        } catch (e) {
          deliveryError =
            e instanceof Error ? e.message : "The text could not be sent.";
        }
      }
      return reply({ url, sent, deliveryError, name: target.display_name });
    }
    if (action === "preferences") {
      withCircleDb((db) =>
        db
          .prepare(
            "UPDATE contacts SET reminders=?,paused=0,next_at=? WHERE member=? AND household=?",
          )
          .run(
            body?.reminders ? 1 : 0,
            Date.now() + (3 + Math.random() * 4) * 86400_000,
            person.person_id,
            household,
          ),
      );
      return reply({ ok: true });
    }
    if (action === "invite" || action === "patient-link") {
      if (!canManage)
        throw new CircleError(
          "Only your family organizer can invite people.",
          403,
        );
      limit("invite:" + person.person_id, 12);
      const patient =
        action === "patient-link"
          ? people.find((p) => p.role === "participant")
          : undefined;
      const name = patient?.display_name || str(body?.name, 80),
        phone = (patient?.phone || str(body?.phone, 30)).replace(
          /[\s()-]/g,
          "",
        );
      if (!name) throw new CircleError("Add their name.");
      if (phone && !/^\+[1-9]\d{7,14}$/.test(phone))
        throw new CircleError("Add a phone number with its country code.");
      let invitation: string | null = null;
      if (!patient) {
        const generated = newInvitationToken();
        await getOnboarding().invite(
          household,
          { display_name: name, role: "family" },
          person.person_id,
          generated.token_hash,
        );
        invitation = generated.token_hash;
      }
      const token = createLink({
        household,
        member: patient?.person_id || null,
        invitation,
        name,
        phone: phone || null,
        role: patient ? "patient" : "family",
        destination: patient ? "/revisit" : "/caregiver",
      });
      const base = readCircle(household).demo
          ? request.headers.get("origin")!
          : publicBase() || request.headers.get("origin")!,
        url = base + "/open#" + token;
      let sent = false,
        deliveryError = "";
      if (body?.send === true && phone) {
        try {
          if (readCircle(household).demo)
            throw new CircleError(
              "Sample families don’t send real texts. Copy the demo link to test joining.",
            );
          await sendText(
            phone,
            `${person.display_name} invited you to your family’s Recall collection. Tap to join and share the stories behind your photographs:\n${url}\n\nThis is a private invitation, valid for 3 days.`,
            digest(token),
          );
          sent = true;
        } catch (e) {
          deliveryError =
            e instanceof Error ? e.message : "Your text could not be sent.";
        }
      }
      return reply({
        url,
        sent,
        deliveryError,
        name,
        expiresAt: new Date(Date.now() + 72 * 3600_000).toISOString(),
      });
    }
    throw new CircleError("This action isn’t available.", 404);
  } catch (e) {
    if (e instanceof CircleError) return reply({ error: e.message }, e.status);
    if (e instanceof OnboardingError) return reply({ error: e.message }, e.code === "already_exists" ? 409 : e.code === "not_found" ? 404 : e.code === "not_allowed" || e.code === "not_a_member" ? 403 : 400);
    if (e instanceof z.ZodError)
      return reply({ error: "Please check the fields and save again." }, 400);
    console.error(
      "[circle]",
      e instanceof Error ? e.message : "Unexpected error",
    );
    return reply(
      {
        error:
          "Something interrupted this step. Your saved memories are safe. Please try again.",
      },
      500,
    );
  }
}
export const GET = handle;
export const POST = handle;
