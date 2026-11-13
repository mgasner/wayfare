import { Check, MessageCircle, Sparkles, X } from "lucide-react";
import { useState } from "react";
import { AppShell } from "../components/AppShell";
import { Button, Chip } from "../components/Button";
import { Sheet } from "../components/Sheet";
import { Stale } from "../components/Stale";
import { StatusChip, StatusTally } from "../components/StatusChip";
import { PagerDots, SwipePager } from "../components/SwipePager";
import { useToast } from "../components/Toast";
import { ThemeGlyph, ThemeStrip } from "../theme/motifs";
import { THEMES, THEME_INFO, useTheme } from "../theme/themes";
import "./gallery.css";

const NOW = Date.parse("2026-11-13T02:45:00Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

/** Living style sheet for the base components, at /dev/gallery. */
export function Gallery() {
  const { theme, setTheme } = useTheme();
  const [sheet, setSheet] = useState(false);
  const [page, setPage] = useState(0);
  const toast = useToast();

  return (
    <AppShell trip={{ title: "Lima", lines: ["Nov 13 to 23 · 2 people", "Gran Hotel Bolívar, Centro"] }} counts={{ discover: 27, saved: 6 }}>
      <header className="g-head">
        <div className="label g-kicker">
          <ThemeGlyph size={14} /> Components · {theme.label}
        </div>
        <h1 className="display g-title">Base kit</h1>
        <p className="muted">Theme tokens, status, freshness, sheet, pager.</p>
      </header>
      <ThemeStrip />

      <section className="g-sec">
        <div className="label muted">Theme</div>
        <div className="g-row">
          {THEMES.map((id) => (
            <Chip key={id} on={theme.id === id} onClick={() => setTheme(id)}>
              <span className="g-sw">
                {THEME_INFO[id].swatches.map((c) => (
                  <i key={c} style={{ background: c }} />
                ))}
              </span>
              {THEME_INFO[id].label}
            </Chip>
          ))}
        </div>
      </section>

      <section className="g-sec">
        <div className="label muted">Meal status</div>
        <StatusTally counts={{ confirmed: 1, requested: 2, waitlist: 1, failed: 1, open: 17 }} />
        <div className="g-row">
          {(["confirmed", "requested", "waitlist", "failed", "want", "skipped", "open"] as const).map((s) => (
            <StatusChip key={s} status={s} size="sm" />
          ))}
        </div>
      </section>

      <section className="g-sec">
        <div className="label muted">Freshness</div>
        <div className="card g-list">
          <div className="g-li">
            <span className="grow">Slots read 4 min ago</span>
            <Stale at={ago(4)} now={NOW} />
            <span className="muted">fresh, no clock</span>
          </div>
          <div className="g-li">
            <span className="grow">Slots read 2 h ago</span>
            <Stale at={ago(125)} now={NOW} label="slots" />
          </div>
          <div className="g-li">
            <span className="grow">Grid cell</span>
            <Stale at={ago(26 * 60)} now={NOW} compact />
          </div>
          <div className="g-li">
            <span className="grow">Hours read 8 days ago</span>
            <Stale at={ago(8 * 24 * 60)} field="hours" now={NOW} />
          </div>
          <div className="g-li">
            <span className="grow">Tap to recheck</span>
            <Stale at={ago(125)} now={NOW} onRecheck={() => toast({ text: "Rechecking slots" })} />
          </div>
        </div>
      </section>

      <section className="g-sec">
        <div className="label muted">Buttons</div>
        <div className="g-row">
          <Button variant="primary">Next: Appetite</Button>
          <Button>Back</Button>
        </div>
        <Button variant="accent" block size="lg" icon={<Sparkles size={18} />}>
          {theme.copy.buildCta("Lima")}
        </Button>
        <div className="g-row">
          <Button size="sm" variant="primary" icon={<Check size={14} />}>
            Mark booked
          </Button>
          <Button size="sm">Hold</Button>
          <Button size="sm" variant="ghost">
            Recheck
          </Button>
          <Button size="sm" iconOnly aria-label="WhatsApp">
            <MessageCircle size={15} />
          </Button>
        </div>
        <div className="g-pick">
          <div className="label g-pick-k">
            <ThemeGlyph size={13} /> {theme.copy.pickKicker}
          </div>
          <div className="display g-pick-t">Verbena · 8:00 PM</div>
          <div className="g-pick-act">
            <Button variant="accent" className="grow">
              Book 8:00 PM
            </Button>
            <Button variant="dark" iconOnly aria-label="Dismiss">
              <X size={16} />
            </Button>
          </div>
        </div>
      </section>

      <section className="g-sec">
        <div className="between">
          <div className="label muted">Pager</div>
          <PagerDots count={3} index={page} onPick={setPage} />
        </div>
        <SwipePager index={page} onIndexChange={setPage} label="Sample pages">
          {["Trip basics", "Where you sleep", "Appetite"].map((t, i) => (
            <div key={t} className="card g-page">
              <div className="label" style={{ color: "var(--accent)" }}>
                Step {i + 1}
              </div>
              <div className="display" style={{ fontSize: 22 }}>
                {t}
              </div>
              <div className="muted">Swipe sideways.</div>
            </div>
          ))}
        </SwipePager>
        <div className="g-row">
          <Button onClick={() => setSheet(true)}>Open sheet</Button>
          <Button onClick={() => toast({ text: "Added Barranco, Fri 10 AM to 6 PM", action: { label: "Undo", run: () => {} } })}>Show toast</Button>
        </div>
      </section>

      <Sheet open={sheet} onClose={() => setSheet(false)} label="Sample sheet">
        <div style={{ padding: "4px 16px 16px" }}>
          <div className="display" style={{ fontSize: 26 }}>
            Mon Nov 16
          </div>
          <p className="muted">Drag the handle down to close.</p>
        </div>
      </Sheet>
    </AppShell>
  );
}
