import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { browserPrincipal, SESSION_COOKIE } from "../session";
import { accountForMember, issueAccount } from "../accounts";
import { getOnboarding, hashToken } from "../onboarding";
import { activeHousehold } from "../active-household";
import { CircleError, limit, withCircleDb } from "./store";
const scrypt = promisify(scryptCallback);
export const digest = (s: string) =>
  createHash("sha256").update(s).digest("hex");
export async function circleIdentity(request: Request, cookieName = SESSION_COOKIE) {
  const principal = browserPrincipal(request, cookieName);
  if (!principal)
    throw new CircleError("Sign in to open your family collection.", 401);
  const account = principal.member_id
    ? accountForMember(principal.member_id)
    : undefined;
  const household =
    account?.household_id ||
    (principal.role === "operator" ? activeHousehold() : undefined);
  if (!household)
    throw new CircleError("Finish setting up your family first.", 403);
  const people = (await getOnboarding().people(household)).filter((p) => !p.removed_at);
  const person =
    people.find((p) => p.person_id === principal.member_id && !p.removed_at) ||
    (principal.role === "operator"
      ? people.find((p) => p.role === "caregiver")
      : undefined);
  if (!person)
    throw new CircleError("Your family access is no longer active.", 403);
  return {
    household,
    person,
    people,
    principal,
    canManage: principal.role === "operator" || person.role === "caregiver",
  };
}
export function loginAvailable(email: string) {
  return !withCircleDb((db) =>
    db
      .prepare("SELECT member FROM logins WHERE email=?")
      .get(email.toLowerCase().trim()),
  );
}
export async function saveLogin(
  member: string,
  email: string,
  password: string,
) {
  email = email.trim().toLowerCase();
  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    email.length > 254 ||
    password.length < 10 ||
    password.length > 128
  )
    throw new CircleError(
      "Use an email address and a password of at least 10 characters.",
    );
  const salt = randomBytes(16).toString("hex"),
    hashed = ((await scrypt(password, salt, 64)) as Buffer).toString("hex");
  try {
    withCircleDb((db) =>
      db
        .prepare("INSERT INTO logins VALUES (?,?,?,?)")
        .run(email, member, salt, hashed),
    );
  } catch {
    throw new CircleError(
      "That email already has an account. Sign in instead.",
      409,
    );
  }
}
export async function passwordPrincipal(email: string, password: string) {
  if (password.length > 128)
    throw new CircleError("The email or password doesn’t match. Please check both.", 401);
  email = email.trim().toLowerCase();
  limit("login:" + digest(email));
  const row = withCircleDb((db) =>
    db.prepare("SELECT * FROM logins WHERE email=?").get(email),
  ) as { member: string; salt: string; password: string } | undefined;
  const check = (await scrypt(
    password,
    row?.salt || "invalid-recall-user",
    64,
  )) as Buffer;
  if (!row || !timingSafeEqual(check, Buffer.from(row.password, "hex")))
    throw new CircleError(
      "The email or password doesn’t match. Please check both.",
      401,
    );
  const account = accountForMember(row.member);
  if (!account) throw new CircleError("This account is no longer active.", 403);
  const member = (await getOnboarding().people(account.household_id)).find(
    (p) => p.person_id === row.member && !p.removed_at,
  );
  if (!member) throw new CircleError("This account is no longer active.", 403);
  return { role: account.role, member_id: account.member_id };
}
export type LinkRecord = {
  hash: string;
  household: string;
  member: string | null;
  invitation: string | null;
  name: string;
  phone: string | null;
  role: "family" | "patient";
  expires: number;
  used: number | null;
  destination: string;
  account_verifier: string | null;
};
export function createLink(
  input: Omit<LinkRecord, "hash" | "expires" | "used" | "account_verifier">,
  hours = 72,
) {
  const token = randomBytes(32).toString("base64url");
  // Creating an organizer-authorized link grants access; opening an old link
  // must never recreate credentials that have since been revoked or rotated.
  if (input.member && !accountForMember(input.member))
    issueAccount(input.household, input.member, input.role);
  const verifier = input.member ? accountForMember(input.member)?.verifier : null;
  withCircleDb((db) =>
    db
      .prepare("INSERT INTO links (hash,household,member,invitation,name,phone,role,expires,used,destination,account_verifier) VALUES (?,?,?,?,?,?,?,?,NULL,?,?)")
      .run(
        digest(token),
        input.household,
        input.member,
        input.invitation,
        input.name,
        input.phone,
        input.role,
        Date.now() + hours * 3600_000,
        input.destination,
        verifier ?? null,
      ),
  );
  return token;
}
export function readLink(token: string): LinkRecord {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token))
    throw new CircleError(
      "This invitation is not available. Ask your family for a new link.",
      410,
    );
  const row = withCircleDb((db) =>
    db
      .prepare(
        "SELECT * FROM links WHERE hash=? AND used IS NULL AND expires>?",
      )
      .get(digest(token), Date.now()),
  ) as LinkRecord | undefined;
  if (!row)
    throw new CircleError(
      "This link has expired or has already been opened. Ask your family for a new one.",
      410,
    );
  return row;
}
export async function claimLink(token: string, reminders?: boolean) {
  const link = readLink(token);
  const reserved = withCircleDb(
    (db) =>
      db
        .prepare(
          "UPDATE links SET used=? WHERE hash=? AND used IS NULL AND expires>?",
        )
        .run(Date.now(), link.hash, Date.now()).changes,
  );
  if (!reserved) throw new CircleError("This link has already been used.", 410);
  try {
    let member = link.member;
    if (!member && link.invitation) {
      member = (await getOnboarding().acceptInvitation(link.invitation))
        .person_id;
      withCircleDb((db) =>
        db
          .prepare("UPDATE links SET member=?,invitation=NULL WHERE hash=?")
          .run(member!, link.hash),
      );
    }
    if (!member) throw new CircleError("Your invitation could not be opened.");
    const person = (await getOnboarding().people(link.household)).find(
      (p) => p.person_id === member && !p.removed_at,
    );
    if (!person)
      throw new CircleError("This family access is no longer active.", 403);
    const account = accountForMember(member);
    if (link.member && (!account || account.verifier !== link.account_verifier))
      throw new CircleError("This family access has changed. Ask your organizer for a new link.", 403);
    if (
      account &&
      (account.household_id !== link.household || account.role !== link.role)
    )
      throw new CircleError(
        "This invitation no longer matches your account.",
        403,
      );
    if (!account) issueAccount(link.household, member, link.role);
    if (!link.member)
      withCircleDb((db) => db.prepare("UPDATE links SET account_verifier=? WHERE hash=?").run(accountForMember(member)!.verifier, link.hash));
    if (link.phone)
      withCircleDb((db) =>
        db
          .prepare(
            "INSERT INTO contacts(member,household,phone,reminders,next_at) VALUES (?,?,?,?,?) ON CONFLICT(member) DO UPDATE SET phone=excluded.phone,reminders=CASE WHEN ? THEN excluded.reminders ELSE contacts.reminders END,next_at=CASE WHEN ? THEN excluded.next_at ELSE contacts.next_at END,paused=CASE WHEN ? THEN 0 ELSE contacts.paused END",
          )
          .run(
            member!,
            link.household,
            link.phone,
            reminders ? 1 : 0,
            Date.now() + (3 + Math.random() * 4) * 86400_000,
            reminders === undefined ? 0 : 1,
            reminders === undefined ? 0 : 1,
            reminders === undefined ? 0 : 1,
          ),
      );
    return {
      principal: { role: link.role, member_id: member },
      destination: link.destination,
    };
  } catch (e) {
    withCircleDb((db) =>
      db.prepare("UPDATE links SET used=NULL WHERE hash=?").run(link.hash),
    );
    throw e;
  }
}
