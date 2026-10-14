import type { NextApiRequest, NextApiResponse } from "next";
import { app } from "../../../server/app";

// Express does its own body parsing (JSON, urlencoded, multipart via multer).
export const config = { api: { bodyParser: false, externalResolver: true, responseLimit: "8mb" } };

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  return (app as any)(req, res);
}
