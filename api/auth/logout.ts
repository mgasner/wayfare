import { logout } from "../../lib/auth.js";

export const GET = (request: Request) => logout(request);
export const POST = GET;
