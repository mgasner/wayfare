# City research pass

You are running Wayfare's research pass for one city, as an Indent session. Your output is a pull request to `indent-com/wayfare` that adds or updates `data/cities/<city>/`. Max reviews it; on merge the Vercel build seeds it into the database.

Inputs from whoever started you: the city id (lowercase, hyphenated, e.g. `lima`), the city name and country, and optionally a list of places to include.

## What to produce

```
data/cities/<city>/city.json          CityFile (shared/research.ts)
data/cities/<city>/areas.json         AreaFile[]
data/cities/<city>/places/<id>.json   PlaceFile, one per place; <id> is the file name
```

`agents/city-research.schema.ts` is the whole output as one zod schema; fact values have the shapes in `shared/facts.ts`. `bin/check-city <city>` validates the directory the same way `bin/seed` does and prints coverage and gaps. Look at `data/cities/lima/` for a finished example.

Coverage before you open the PR:
- At least 25 reservation places (`reserve_ahead`: tasting menus and rooms that sell out weeks ahead; `bookable`: book a day or two ahead) and at least 20 `walk_in` or `informal` places (cevicherías, counters, markets, bars, bakeries).
- Every main area has a brief and at least two stops.
- Places you find closed are included with `status: "closed"`, never deleted or left out. They stay hidden in the app and stop the next pass from re-adding them as new.

## Segments

Start five subagents, one per segment, plus a sixth for `city.json`. Give each the rules below, the files it owns, and the list of ids the others are using so no place is written twice.

1. **Tasting menus and reserve-ahead**: the city's World's 50 Best, Latin America's 50 Best (or regional equivalent) and local-guide top rooms. Read the booking widget's calendar for release windows, deposits and card requirements, without entering any personal data.
2. **Bookable mid-range**: well-reviewed rooms you can book a day or two ahead.
3. **Walk-in classics**: the city's signature everyday food (in Lima: cevicherías, chifas, anticucherías, sangucherías, old bars).
4. **Informal places and markets**: counters, stalls, markets, bakeries, ice cream; places a local would send a friend.
5. **Areas**: `areas.json`. For each neighborhood a visitor eats in: a two-to-four sentence brief (character, who goes, getting there, safety at night) and stops (walks, parks, museums, markets, bar streets) with coordinates and a link.
6. **City config**: `city.json`. Booking platforms and how each one shows availability, messaging apps restaurants answer on, closure days, release norms, card behavior with foreign cards, ID or passport fields on booking forms, tipping.

## Each place

- `id`: lowercase-hyphenated name, plus a district when the name is common (`punto-azul-miraflores`). Never change an existing id; saves and meals point at it.
- `name`: the name on the door. `area`: an id from `areas.json`.
- `kind`: `reserve_ahead`, `bookable`, `walk_in` or `informal`.
- `channels`: how to book or reach it, in order of preference. A Mesa 24/7 venue needs `host`, `slug`, `local_id` and, when the widget asks for an experience, `consumption_id`; find them in the widget's network calls. A Meitre venue needs `venue_id`. Business phone and WhatsApp numbers in E.164. `walk_in` when it takes no bookings.
- `summary`: two or three sentences in our own words: what it is, who it suits, the main caveat. No availability for particular dates, no quotes from reviews.
- `links`: official site, booking page, Instagram, and the reviews and guides you relied on (Reddit threads, TripAdvisor, critics, press). Link them; never copy their text into the files.
- `facts`, each with `checked_at` (UTC, when you read it): `status` (`open`, `closed`, `temporarily_closed`), `hours` (`{ text, closed_days }`, 0 = Sunday), `price_pp` (`{ usd, text }`), `cuisine`, `menu` (`{ name, items, as_of, source_url }`, up to 12 items described in our words), `deposit_policy`, `dress`, `notes` (`{ tier, format, pros, cons, accolades, chef, how_to_book, reviews }`, where `reviews` holds only `rating` and `count` per source and `summary: null`). Leave out what you could not find; don't guess.
- `google_place_id`: from the Places API (New) Text Search with the Maps key secret: `POST https://places.googleapis.com/v1/places:searchText` with `X-Goog-FieldMask: places.id,places.displayName,places.formattedAddress`. Store only the id. Google's coordinates, ratings and review text are not stored.
- Coordinates and `overture_id`: after the files exist, run `bin/seed` then `bin/load-overture <city>` against a local `DB_FILE`. It matches each place to the nearest Overture record by name within 150 m and writes `overture_id` and Overture's coordinates into the place files. For places it reports as unmatched, look the address up in OpenStreetMap (Nominatim, at most one request a second, with a User-Agent naming Wayfare) and use those coordinates; if neither has the place, leave the research coordinates and say so in the PR.

Verify that a place is open from at least two sources dated within the last six months (official site or Instagram post, a recent review, a booking widget that shows times). Press about a closure, a "cerrado definitivamente" listing or a dead widget means `status: "closed"` with the source in `notes`.

## Rules

- Never enter personal details (name, email, phone, card, passport) into any form, never submit a reservation and never create accounts. Going as far as the time picker to read slots is fine.
- Reddit and TripAdvisor often block automated reads. Use search snippets and say so in the PR rather than working around the block.
- When tooling slows you down, search `indent-com/papercuts` (`bin/papercut search` in neo) and +1 a match or file one.

## Finish

1. `bin/check-city <city>`, then `DB_FILE=/tmp/<city>.db bin/migrate && bin/seed && bin/load-overture <city>`, then `pnpm typecheck && pnpm test`.
2. Open one PR titled `data: <City> research pass` with: counts by kind, which places are new, changed or newly closed, places without a Google id or Overture match, sources that were blocked, and anything you were unsure of.
