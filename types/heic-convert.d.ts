declare module 'heic-convert' {
 export default function convert(input:{buffer:Buffer;format:'JPEG'|'PNG';quality?:number}):Promise<ArrayBuffer>;
}
