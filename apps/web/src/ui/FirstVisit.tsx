import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

const KEY = "tt-guide-seen";

type Step = { id: string; title: string; body: string; items?: string[]; optional?: boolean };

const STEPS: Step[] = [
  {
    id: "mark",
    title: "Build the week in this order",
    body: "Teachers can be added at any time. Classes, subjects, rooms, lessons, constraints, and generate wait until this year has a template.",
    items: [
      "Pick the academic year, then create a template and its bell times.",
      "Add teachers. Then classes, subjects, and any rooms.",
      "Add lesson cards. Then constraints.",
      "Generate, check the week, and Save file.",
    ],
  },
  {
    id: "year",
    title: "Academic year",
    body: "Every screen follows the year chosen here. A template belongs to one year.",
  },
  {
    id: "templates",
    title: "Template first",
    body: "A template is one weekly plan: which weekdays, how many teaching periods, and the clock times. Create it before classes or subjects.",
    items: [
      "Breaks and lunch are not teaching slots. Period numbers skip them.",
      "A double or triple must sit on consecutive teaching bells. A break in between blocks it.",
      "One year can hold several templates. Each template has its own bells, lessons, and rules.",
    ],
  },
  {
    id: "bells",
    title: "Bell times",
    body: "Set each period’s start and end. Later times cascade. Mark prayer, breaks, and lunch so they cannot take a lesson.",
    optional: true,
  },
  {
    id: "teachers",
    title: "Teachers",
    body: "Add teachers before or after the template. They are stored in the timetable file.",
    items: [
      "Name, short name, department, and Active or Inactive.",
      "An inactive teacher cannot be chosen for a lesson, a class, or a rule.",
      "A teacher already on a lesson, or set as class teacher, cannot be made inactive or deleted until that assignment is cleared.",
    ],
  },
  {
    id: "classes",
    title: "Classes",
    body: "A class is the grade plus the section, for the year in the sidebar.",
    items: [
      "Class, section, short name, and an optional class teacher.",
      "The class teacher is who Class teacher only and No class teacher rules use.",
      "This tab stays closed until the year has a template.",
    ],
  },
  {
    id: "subjects",
    title: "Subjects",
    body: "One subject for the whole school. Grade 1 English and Grade 3 English are two lessons, not two subjects.",
    items: [
      "Name, short name, colour, and type: Core, Language, Physical, Activity, or Other.",
      "Type is what No core, No language, and No PE look at.",
      "This tab stays closed until the year has a template.",
    ],
  },
  {
    id: "rooms",
    title: "Rooms",
    body: "Add a room when a lesson needs somewhere other than the class home room. The generator assigns one free room per card.",
    items: [
      "Name, type (for example lab), capacity, and building.",
      "A room smaller than the class is skipped. Two lessons cannot share a room in one period.",
      "On a lesson, Allowed rooms limits the choices. Empty means the home room plus rooms of the required type.",
      "Generate prefers the home room. It penalizes a class that changes room with no break, and a teacher who changes building with no break.",
    ],
    optional: true,
  },
  {
    id: "lessons",
    title: "Lesson cards",
    body: "A lesson is one card: who teaches what, to which class, how often.",
    items: [
      "Subject, one or more classes, one or more teachers, periods per week, and length in bells.",
      "Blocks overrides that shape. 2,1,1,1 means one double and three singles.",
      "Every week fills that period in both weeks. Odd week leaves it free on Even week. Even week is the reverse.",
      "On Construction, Both weeks keeps one shared layout. Separate weeks lets Odd and Even diverge; return to Both asks which week becomes the default.",
      "An Odd week card and an Even week card may share a period. An Every week card clashes with both.",
      "Use Odd/Even for fortnightly subjects (e.g. Art one week, Dance the next). The app does not map calendar dates to Odd or Even.",
    ],
  },
  {
    id: "constraints",
    title: "Painted constraints",
    body: "Constraints tell generate which periods are allowed. Must is hard. Prefer is a penalty times the weight.",
    items: [
      "Staff: Can teach, or Not available.",
      "Class: Open, No core, No language, No PE, Class teacher only, No class teacher. Open clears a cell. There is no class-not-available paint.",
      "Subject time off blocks every lesson of that subject. Room time off removes that room for those periods.",
      "Clone copies one class’s painted week onto other classes. The targets are replaced.",
    ],
    optional: true,
  },
  {
    id: "rules",
    title: "Named rules",
    body: "These sit on Constraints, Global tab. Add one, set Must or Prefer, and a weight.",
    items: [
      "Teacher load: max lessons per day, max days per week, min lessons on a working day, lunch break, start after a period, end before a period, max consecutive, max window, min window, contract hours.",
      "A window is span minus occupied: last period, minus first period, plus 1, minus the lessons in between.",
      "Placement: preferred period, preferred day, preferred room, same room, same room all week, at least N in a room type, at most N in a room type, different room.",
      "Pairs: lessons together (same day), lessons apart, same time, different time, before, after, consecutive.",
      "Subject spread: subject distribution, max of that subject per day, avoid consecutive difficult subjects.",
    ],
  },
  {
    id: "construct",
    title: "Generate",
    body: "Construction places the cards. Fast and balanced make quick variants. Best also runs the slower solver.",
    items: [
      "These classes only rebuilds the classes you pick. Other classes stay as they are for that run. That pin is not saved as a lock.",
      "A class day is one solid block. Generate will not leave a hole between that class’s lessons.",
      "If the week is impossible, the result names the hard rules and the tightest teacher, class, or room.",
      "Broken soft rules are listed on the chip, heaviest weight first.",
      "Use keeps that solution. Save file writes it.",
    ],
  },
  {
    id: "save",
    title: "Save file",
    body: "Save file writes year-template.ttl for the template you have open.",
    items: [
      "The file includes teachers, classes, subjects, rooms, lessons, bell times, constraints, and the placed week.",
      "Other templates are not copied into that file.",
      "Double-click the file to open it.",
    ],
  },
  {
    id: "after",
    title: "After the week exists",
    body: "Reports, My timetable, and Class timetable read the saved week. Substitution covers one date and does not rewrite the published week. Quality shows hard clashes and teacher gaps. Light, Dark, and Guide stay in the sidebar.",
  },
];

function visibleSteps() {
  return STEPS.filter((step) => !step.optional || document.querySelector(`[data-tour="${step.id}"]`));
}

export default function FirstVisit({ nonce }: { nonce: number }) {
  const [on, setOn] = useState(false);
  const [index, setIndex] = useState(0);
  const [box, setBox] = useState<{ top: number; left: number; width: number; height: number; cardTop: number; cardLeft: number } | null>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const stepsRef = useRef<Step[]>(STEPS);

  function finish() {
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      /* ignore */
    }
    setOn(false);
  }

  useEffect(() => {
    if (nonce === 0) {
      try {
        if (localStorage.getItem(KEY) === "1") return;
      } catch {
        /* show the guide when storage is blocked */
      }
    }
    stepsRef.current = visibleSteps();
    setIndex(0);
    setOn(true);
  }, [nonce]);

  useEffect(() => {
    if (!on) return;
    const steps = stepsRef.current;
    const step = steps[index];
    if (!step) {
      finish();
      return;
    }
    const el = document.querySelector(`[data-tour="${step.id}"]`);
    if (!el) {
      setBox({
        top: -999,
        left: -999,
        width: 0,
        height: 0,
        cardTop: 72,
        cardLeft: Math.max(16, (window.innerWidth - 560) / 2),
      });
      nextRef.current?.focus();
      return;
    }
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
    const place = () => {
      const r = el.getBoundingClientRect();
      if (r.right < 16) window.dispatchEvent(new Event("tt-open-menu"));
      const cardW = 560;
      const gap = 12;
      const onScreen = r.right > 16 && r.left < window.innerWidth - 16 && r.width > 0;
      let left = onScreen ? r.right + gap : 16;
      if (left + cardW > window.innerWidth - 16) left = Math.max(16, Math.min(onScreen ? r.left : 16, window.innerWidth - cardW - 16));
      let top = onScreen ? r.bottom + gap : 72;
      if (top + 200 > window.innerHeight) top = Math.max(16, onScreen ? r.top - 200 : 72);
      setBox({
        top: onScreen ? r.top : -999,
        left: onScreen ? r.left : -999,
        width: onScreen ? r.width : 0,
        height: onScreen ? r.height : 0,
        cardTop: top,
        cardLeft: left,
      });
    };
    place();
    const later = window.setTimeout(place, 260);
    nextRef.current?.focus();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.clearTimeout(later);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [on, index]);

  if (!on || !box) return null;
  const steps = stepsRef.current;
  const step = steps[index];
  if (!step) return null;
  const last = index === steps.length - 1;

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      finish();
    }
  }

  return (
    <div className="tour" onKeyDown={onKey}>
      <div className="tour-scrim" />
      {box.width > 0 && (
        <div className="tour-ring" style={{ top: box.top, left: box.left, width: box.width, height: box.height }} />
      )}
      <div className="tour-card" role="dialog" aria-modal="true" aria-labelledby={titleId} style={{ top: box.cardTop, left: box.cardLeft }}>
        <p className="tour-count">{index + 1} of {steps.length}</p>
        <h2 id={titleId}>{step.title}</h2>
        <p>{step.body}</p>
        {step.items && step.items.length > 0 && (
          <ul>
            {step.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        )}
        <div className="tour-actions">
          <button type="button" onClick={finish}>Skip</button>
          {index > 0 && (
            <button type="button" onClick={() => setIndex((n) => n - 1)}>Back</button>
          )}
          <button
            type="button"
            ref={nextRef}
            className="bg-accent text-accent-ink"
            onClick={() => (last ? finish() : setIndex((n) => n + 1))}
          >
            {last ? "Done" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
