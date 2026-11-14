import { Link } from "react-router-dom";

export function yearHasTemplate(rows: { academic_year_id?: string }[] | undefined, yearId: string) {
  return (rows || []).some((row) => !yearId || row.academic_year_id === yearId);
}

export default function NeedTemplate({ what }: { what: string }) {
  return (
    <div className="bg-paper-3 border border-rule rounded-xl p-8 text-center">
      <h2 className="font-semibold text-ink">Create a template first</h2>
      <p className="text-sm text-muted mt-2 max-w-lg mx-auto">
        {what} needs a timetable template for this year. Teachers can be added before that. Add the template under Templates, then come back.
      </p>
      <Link to="/timetable" className="inline-block mt-4 bg-accent text-accent-ink rounded-lg px-4 py-2 text-sm font-medium">
        Go to Templates
      </Link>
    </div>
  );
}
