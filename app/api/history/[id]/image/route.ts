import { getChatGPTUser } from "../../../../chatgpt-auth";
import { getHistoryImageForEmail } from "../../../../../db/history";

export const runtime = "edge";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const identity = await getChatGPTUser();
  if (!identity) return new Response("Connexion requise.", { status: 401 });

  const { id } = await context.params;
  try {
    const image = await getHistoryImageForEmail(identity.email, id);
    if (!image) return new Response("Image introuvable.", { status: 404 });
    const download = new URL(request.url).searchParams.get("download") === "1";
    return new Response(image.object.body, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Type": image.mimeType,
        "Content-Disposition": download
          ? `attachment; filename="${image.filename}"`
          : "inline",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Image momentanément indisponible.", { status: 500 });
  }
}
