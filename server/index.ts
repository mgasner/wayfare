// Every server file with entrypoints, by its name under /api/<file>/<export>.
import * as agent from "./agent.js";
import * as anchors from "./anchors.js";
import * as cities from "./cities.js";
import * as facts from "./facts.js";
import * as input from "./input.js";
import * as me from "./me.js";
import * as meals from "./meals.js";
import * as places from "./places.js";
import * as saves from "./saves.js";
import * as travel from "./travel.js";
import * as trips from "./trips.js";

export const modules = { agent, anchors, cities, facts, input, me, meals, places, saves, travel, trips };
