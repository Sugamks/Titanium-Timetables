export type HelpSection = { heading: string; items: string[] };
export type HelpPageId =
  | "workspace"
  | "groups"
  | "templates"
  | "mine"
  | "class"
  | "reports"
  | "constraints"
  | "lessons"
  | "generate"
  | "operations"
  | "analyze"
  | "ai";

export const PAGE_HELP: Record<
  HelpPageId,
  { title: string; intro: string; sections: HelpSection[] }
> = {
  workspace: {
    title: "Construct timetable",
    intro: "Add the academic year on Templates first. A year can hold several templates. Save writes year-template.ttl. Double-click that file to open it.",
    sections: [
      {
        heading: "What you can do",
        items: [
          "Use five tabs: Teachers, Class section, Subjects, Lessons, then Construction.",
          "The sidebar list switches the current year. Add a year on Templates.",
          "Add teachers on Teachers. Add the class and section on Class section. Add subjects on Subjects.",
          "Generate several solutions, preview them, then Use to keep one.",
          "Save writes year-template.ttl. Double-click that file to open it.",
        ],
      },
      {
        heading: "Subjects",
        items: [
          "Add subjects once for the whole school (uppercased), short code, colour, and type: Core, Language, Physical, Activity, or Other.",
          "Subject type drives class rules (no language / no core / no PE in a period).",
        ],
      },
      {
        heading: "Lessons",
        items: [
          "A lesson is a card to place: subject, class(es), teacher(s), length (consecutive bells), and periods per week.",
          "Length is how many bells one sitting uses. Periods/week is how often it appears.",
          "Shared (multi-class) cards have a violet “shared” mark. They are not the same as a language group.",
          "After Generate, stack two subjects in one cell and click Save group. Shared cards copy those group names onto the related classes. Generate again keeps saved groups.",
          "Clone copies a class plan onto other classes as independent lessons you can edit later.",
          "Empty classes (no lessons yet) are hidden from this list.",
        ],
      },
      {
        heading: "Construction (generate & save)",
        items: [
          "Fast / balanced make several quick variants. Best also runs a slower solver.",
          "Click a solution chip to preview. Sorted best-first. Gaps are idle holes in a teacher’s day, not breaks.",
          "Hard / Clear: leftover clashes or missing cards. 0 hard means every card is placed with no double-booking.",
          "Use saves that solution. You cannot swap periods on a preview — Use first.",
          "Stack language options in one cell, Save group, then Generate the remaining subjects. Grouped periods stay locked.",
          "Save writes year-template.ttl. Double-click that file to open it.",
        ],
      },
    ],
  },
  groups: {
    title: "Groups",
    intro: "Period groups share one slot. Class splits divide one class. They are not the same as two teachers on one subject.",
    sections: [
      {
        heading: "Period group",
        items: [
          "Pick the template first. Groups on another template stay hidden.",
          "Add the subject–class lessons on Construct first for that same template.",
          "Name the group (LANGUAGE), pick two or more subjects, pick the classes, then create.",
          "You can still stack cards on the timetable and save a group there.",
        ],
      },
      {
        heading: "Class split",
        items: [
          "Use this when one class divides (French A / French B).",
          "Two teachers on Hindi is not a split — add both teachers on that lesson.",
        ],
      },
    ],
  },
  templates: {
    title: "Timetable templates",
    intro: "Bell times and breaks live here. Create each template in this app.",
    sections: [
      {
        heading: "What you can do",
        items: [
          "Add an academic year with Add year at the top of this page. The sidebar list only switches the current year.",
          "Create a weekly template, set how many teaching periods, and which weekdays to include.",
          "Edit period start/end times (they cascade). Mark breaks and assembly so they are not teaching slots.",
          "Period numbers skip breaks (Period 1, 2… only on teaching bells).",
          "The weekly grid stays hidden until times are saved.",
          "Settings change name, days, and teaching period count. Clone copies bells into a new unique name (optional: also copy placements).",
          "Integrity check reports missing times, missing teachers/classes, clashes, and unplaced cards.",
          "Delete hides a template from Construct; restore brings it back. Permanent delete is only on Show deleted. You cannot delete a period that already has lessons.",
        ],
      },
      {
        heading: "Rules",
        items: [
          "Only teaching periods can take lessons.",
          "A double/triple lesson must sit on consecutive teaching bells (a break in between blocks it).",
          "Class period types (NOSL, CTON, and so on) are not painted here — they belong on Constraints.",
        ],
      },
    ],
  },
  mine: {
    title: "My timetable",
    intro: "The published week for one teacher.",
    sections: [
      {
        heading: "What you can do",
        items: [
          "Pick a teacher and see their classes after Publish.",
          "If nothing shows, no timetable is published yet.",
        ],
      },
      {
        heading: "Rules",
        items: [
          "This view is read-only. Changes happen on Construct, then Publish.",
        ],
      },
    ],
  },
  class: {
    title: "Class timetable",
    intro: "The saved week for one class. This is the parent-facing view.",
    sections: [
      {
        heading: "What you can do",
        items: [
          "Pick a class and a template to see subject and teacher for each period.",
          "Each template has its own saved or published week. Switch template to see that plan.",
        ],
      },
      {
        heading: "Rules",
        items: ["Read-only. Changes happen on Construct, then Save or Publish."],
      },
    ],
  },
  reports: {
    title: "Reports",
    intro: "On-screen timetable views. Download Excel for class and staff sheets.",
    sections: [
      {
        heading: "What you can do",
        items: [
          "Switch class, teacher, subject, unplaced, teacher load, and class load.",
          "Download saves an Excel matrix: classes (or staff) as rows, days across the top, period numbers under each day, and color-coded subject codes.",
          "Unplaced lists lesson cards that still need a slot.",
        ],
      },
      {
        heading: "Rules",
        items: [
          "Reports need a timetable version with placements. Generate (and Use) first.",
          "Load compares placed periods against teaching slots in the template.",
        ],
      },
    ],
  },
  constraints: {
    title: "Constraints",
    intro: "Tell generate which periods are allowed. Paint cells on Staff and Class; use Other for load and preferences.",
    sections: [
      {
        heading: "Staff tab",
        items: [
          "Pick a teacher. Choose Can teach or Not available, then click a period.",
          "Red = that teacher cannot be scheduled there.",
          "Click the same cell again to clear it.",
        ],
      },
      {
        heading: "Class tab",
        items: [
          "Pick a class, choose a paint tool, click periods. One type per cell.",
          "Open: any subject. There is no class-not-available rule — use Open to clear a cell.",
          "No core (NOCP), No language (NOSL), No PE (NOPA) block those subject types.",
          "Class teacher only (CTON): only that class teacher. Not class teacher (NCTON): that person cannot teach then.",
          "Set the class teacher on the School tab. CTON/NCTON will not save if it is missing.",
          "Clone from one class into others to copy the painted week. Target classes are replaced, not merged.",
        ],
      },
      {
        heading: "Other tab",
        items: [
          "Max lessons per day, consecutive limits, preferred days/periods, same-time, and similar rules.",
          "Must = hard (generate will not break it). Prefer = ranking only.",
          "These are not painted on the grid; they are named rules you add and delete.",
        ],
      },
      {
        heading: "How generate uses this",
        items: [
          "Hard rules block a slot in fast, balanced, and best generate, and when you drag a card.",
          "Leaving a required card unplaced, or still clashing, counts as Hard on the solution chips.",
        ],
      },
    ],
  },
  lessons: {
    title: "Lessons",
    intro: "Older plan page for lesson cards. Prefer Construct → Lessons for day-to-day work.",
    sections: [
      {
        heading: "What you can do",
        items: [
          "Create lesson cards: subject, class, teacher, frequency, length.",
          "These cards are what generate places on the week.",
        ],
      },
    ],
  },
  generate: {
    title: "Generate",
    intro: "Standalone generate screen. The same engine is on Construct → Timetable.",
    sections: [
      {
        heading: "What you can do",
        items: [
          "Run fast, balanced, or best. Compare scores, then apply a solution as a draft.",
          "Local repair tries to fix the current version.",
        ],
      },
      {
        heading: "Score and Hard",
        items: [
          "Score starts at 100, minus teacher gaps and missing cards. Higher is better.",
          "Hard is clashes plus unplaced cards. 0 is a complete clash-free week.",
        ],
      },
    ],
  },
  operations: {
    title: "Substitution",
    intro: "Pick a date, add absentees, cover or ignore each period, then publish.",
    sections: [
      {
        heading: "Substitution day",
        items: [
          "Pick the template you are covering. Another template’s day stays hidden here.",
          "The date opens (or creates) a substitution day against that template’s saved or published week.",
          "Add absence is ad-hoc: teacher plus full day, morning, afternoon, or custom times. The same teacher cannot be added twice.",
          "Select an absentee to see their day as a timetable. Click a period, then click a free teacher in the side list — no modal.",
          "School day shows every class for that weekday. Highlighted cells are absences; click one to assign cover.",
          "Only free staff are listed unless you turn on Show busy. Caps stay 1 / 3 / 12 per day / week / month.",
          "Publish locks the day. You can still change or remove a cover afterwards.",
        ],
      },
      {
        heading: "Exemptions",
        items: [
          "Exempt a teacher from covering others, full or partial, with an optional date range.",
          "Full exemption sorts that teacher to the bottom and marks them blocked; partial only lowers their score.",
        ],
      },
    ],
  },
  analyze: {
    title: "Timetable quality",
    intro: "Metrics for the current timetable: hard constraints, gaps, overall score.",
    sections: [
      {
        heading: "What the numbers mean",
        items: [
          "Hard constraints must be 0 (or hard_ok) before publish is allowed.",
          "Teacher gaps are idle periods between a teacher’s first and last lesson that day.",
          "Preference / overall scores rank compactness, not whether clashes exist.",
        ],
      },
    ],
  },
  ai: {
    title: "Timetable AI",
    intro: "Turn a sentence into a structured command. Nothing is saved until you apply.",
    sections: [
      {
        heading: "What you can do",
        items: [
          "Preview a command (for example add a constraint).",
          "Apply writes it. Reject by not applying.",
        ],
      },
    ],
  },
};
