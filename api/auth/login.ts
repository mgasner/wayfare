import { login } from "../../lib/auth.js";

export const GET = (request: Request) => login(request);
