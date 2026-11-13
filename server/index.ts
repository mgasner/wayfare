// Every server file with entrypoints, by its name under /api/<file>/<export>.
import * as me from "./me.js";
import * as meals from "./meals.js";
import * as saves from "./saves.js";
import * as trips from "./trips.js";

export const modules = { me, meals, saves, trips };
