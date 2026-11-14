import { useEffect, useState } from "react";
import { api } from "../api";
import { useToast } from "../ui/Toast";
import ErrorBanner from "../ui/ErrorBanner";
import { Field, inputClass } from "../ui/SearchSelect";
import PageHelp from "../ui/PageHelp";
import NeedTemplate, { yearHasTemplate } from "../ui/NeedTemplate";
import { currentYearId } from "../year";

export default function RoomsPage() {
  const toast = useToast();
  const [rooms, setRooms] = useState<any[]>([]);
  const [hasTemplate, setHasTemplate] = useState<boolean | null>(null);
  const [err, setErr] = useState("");
  const [form, setForm] = useState({ name: "", room_type: "", capacity: 30, building: "" });

  async function load() {
    const cat = await api<any>("/v1/catalog");
    setRooms(cat.rooms || []);
    setHasTemplate(yearHasTemplate(cat.timetables, currentYearId()));
  }

  useEffect(() => {
    load().catch((e: any) => {
      setErr(e.message);
      setHasTemplate(true);
    });
  }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    try {
      const roomName = form.name.trim();
      await api("/v1/rooms", { method: "POST", body: JSON.stringify({ ...form, capacity: Number(form.capacity) || 30 }) });
      setForm({ name: "", room_type: "", capacity: 30, building: "" });
      await load();
      toast(`Added room “${roomName}”.`);
    } catch (ex: any) {
      setErr(ex.message);
    }
  }

  async function save(room: any) {
    setErr("");
    try {
      await api(`/v1/rooms/${room.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: room.name,
          room_type: room.room_type,
          capacity: Number(room.capacity) || 1,
          building: room.building,
          is_active: room.is_active !== false,
        }),
      });
      toast(`Saved room “${room.name}”.`);
      await load();
    } catch (ex: any) {
      setErr(ex.message);
    }
  }

  if (hasTemplate === null) return null;
  if (!hasTemplate) return <NeedTemplate what="Rooms" />;

  return (
    <div className="space-y-4">
      <header>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold">Rooms</h1>
          <PageHelp page="rooms" />
        </div>
        <p className="text-muted text-sm">Name, type, capacity, and building. The generator picks one free room per lesson.</p>
      </header>
      <ErrorBanner message={err} onClear={() => setErr("")} />
      <form onSubmit={add} className="flex flex-wrap gap-2 items-end bg-paper-3 border rounded-xl p-3">
        <Field label="Name">
          <input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        </Field>
        <Field label="Type">
          <input className={inputClass} placeholder="lab" value={form.room_type} onChange={(e) => setForm({ ...form, room_type: e.target.value })} />
        </Field>
        <Field label="Capacity">
          <input type="number" min={1} className={inputClass} value={form.capacity} onChange={(e) => setForm({ ...form, capacity: Number(e.target.value) })} />
        </Field>
        <Field label="Building">
          <input className={inputClass} value={form.building} onChange={(e) => setForm({ ...form, building: e.target.value })} />
        </Field>
        <button className="h-[42px] px-4 bg-accent text-accent-ink rounded-lg text-sm">Add room</button>
      </form>
      <div className="bg-paper-3 border rounded-xl divide-y">
        {rooms.length === 0 && <p className="p-4 text-sm text-muted">No rooms yet.</p>}
        {rooms.map((room) => (
          <RoomRow key={room.id} room={room} onSave={save} onDelete={async () => {
            setErr("");
            try {
              await api(`/v1/rooms/${room.id}`, { method: "DELETE" });
              toast(`Removed room “${room.name}”.`);
              await load();
            } catch (ex: any) {
              setErr(ex.message);
            }
          }} />
        ))}
      </div>
    </div>
  );
}

function RoomRow({ room, onSave, onDelete }: { room: any; onSave: (room: any) => void; onDelete: () => void }) {
  const [row, setRow] = useState(room);
  useEffect(() => setRow(room), [room]);
  return (
    <div className="p-3 flex flex-wrap gap-2 items-end">
      <Field label="Name">
        <input className={inputClass} value={row.name || ""} onChange={(e) => setRow({ ...row, name: e.target.value })} />
      </Field>
      <Field label="Type">
        <input className={inputClass} value={row.room_type || ""} onChange={(e) => setRow({ ...row, room_type: e.target.value })} />
      </Field>
      <Field label="Capacity">
        <input type="number" className={inputClass} value={row.capacity || 0} onChange={(e) => setRow({ ...row, capacity: Number(e.target.value) })} />
      </Field>
      <Field label="Building">
        <input className={inputClass} value={row.building || ""} onChange={(e) => setRow({ ...row, building: e.target.value })} />
      </Field>
      <Field label="Status">
        <select
          className={`${inputClass} h-[42px]`}
          value={row.is_active === false ? "inactive" : "active"}
          onChange={(e) => setRow({ ...row, is_active: e.target.value === "active" })}
        >
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </Field>
      <button type="button" className="h-[42px] px-3 border rounded-lg text-sm" onClick={() => onSave(row)}>Save</button>
      <button type="button" className="h-[42px] px-3 text-sm text-error" onClick={onDelete}>Delete</button>
    </div>
  );
}
