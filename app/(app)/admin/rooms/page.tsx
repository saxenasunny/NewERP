import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireAccountContext } from "@/lib/auth/account";
import { listRooms } from "@/modules/timetable/timetable-service";

import { createRoomAction, deleteRoomAction } from "./actions";

export const metadata: Metadata = { title: "Campus Rooms & Labs · Admin" };

export default async function AdminRoomsPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const account = await requireAccountContext();
  if (!account.tenant) redirect(account.homePath);

  const { notice, error } = await searchParams;
  const canManage = account.permissions.has("academic_structure.manage");
  const rooms = await listRooms(account);

  return (
    <div className="flex flex-col gap-8 pb-12">
      <Breadcrumbs items={[{ label: "Admin", href: "/admin/offerings" }, { label: "Campus rooms & labs" }]} />

      <PageHeader
        eyebrow={account.tenant.institutionName}
        title="Classrooms & Laboratories"
        description="Physical classrooms, lecture theatres, and computing labs across campus for weekly timetable scheduling."
        actions={
          <Link href="/admin/offerings">
            <Button variant="secondary" size="sm">
              Course Offerings →
            </Button>
          </Link>
        }
      />

      {notice ? <Alert tone="success" title="Success">{notice}</Alert> : null}
      {error ? <Alert tone="danger" title="Error">{error}</Alert> : null}

      <div className="grid gap-8 lg:grid-cols-3">
        {/* Left Column: Add Room Form (1 col) */}
        {canManage ? (
          <div className="lg:col-span-1">
            <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm sticky top-6">
              <h2 className="text-base font-bold text-ink mb-1">Add New Room or Lab</h2>
              <p className="text-xs text-ink-muted mb-4">
                Define a physical classroom or laboratory available for timetable scheduling.
              </p>

              <form action={createRoomAction} className="flex flex-col gap-4">
                <Input
                  id="room-code"
                  label="Room / Lab Code"
                  name="code"
                  placeholder="e.g. B-204, CSE-LAB-1, LT-1"
                  required
                  hint="Unique identifier displayed on student timetables."
                />

                <Input
                  id="room-building"
                  label="Building / Block"
                  name="building"
                  placeholder="e.g. Engineering Block B, Main Complex"
                  required
                />

                <div className="grid grid-cols-2 gap-3">
                  <Input
                    id="room-floor"
                    label="Floor"
                    name="floor"
                    type="number"
                    defaultValue="1"
                    min={-2}
                    max={20}
                    required
                  />

                  <Input
                    id="room-capacity"
                    label="Capacity"
                    name="capacity"
                    type="number"
                    defaultValue="60"
                    min={1}
                    max={1000}
                    required
                    hint="Seating capacity"
                  />
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="checkbox"
                    id="isLab"
                    name="isLab"
                    value="true"
                    className="size-4 rounded border-border text-brand-600 focus:ring-brand-500"
                  />
                  <label htmlFor="isLab" className="text-xs font-semibold text-ink cursor-pointer">
                    This is a Specialized Laboratory / Workshop
                  </label>
                </div>

                <Button type="submit" variant="primary" size="md" className="w-full mt-2 font-bold">
                  Create Room
                </Button>
              </form>
            </div>
          </div>
        ) : null}

        {/* Right Column: Rooms List (2 cols) */}
        <div className={`flex flex-col gap-4 ${canManage ? "lg:col-span-2" : "lg:col-span-3"}`}>
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-ink">
              Registered Campus Rooms ({rooms.length})
            </h2>
          </div>

          {rooms.length === 0 ? (
            <EmptyState
              title="No campus rooms registered yet"
              description="Add your first classroom or laboratory using the form on the left to start assigning periods."
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {rooms.map((room) => (
                <div
                  key={room.id}
                  className="flex flex-col justify-between rounded-2xl border border-border bg-surface p-5 shadow-xs transition-all hover:border-brand-200 hover:shadow-md"
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-mono text-sm font-extrabold text-ink bg-surface-muted px-2.5 py-1 rounded-lg">
                        {room.code}
                      </span>
                      {room.isLab ? (
                        <StatusBadge tone="brand">🔬 Laboratory</StatusBadge>
                      ) : (
                        <StatusBadge tone="neutral">Classroom</StatusBadge>
                      )}
                    </div>

                    <h3 className="mt-3 text-sm font-bold text-ink">
                      {room.building}
                    </h3>
                    <p className="text-xs text-ink-muted mt-0.5">
                      Floor {room.floor} · {room.capacity} seats capacity
                    </p>
                  </div>

                  <div className="mt-4 pt-3 border-t border-border flex items-center justify-between text-xs">
                    <span className="text-ink-muted">
                      <strong className="text-ink">{room.slotCount ?? 0}</strong> active slots
                    </span>

                    {canManage ? (
                      <form action={deleteRoomAction}>
                        <input type="hidden" name="roomId" value={room.id} />
                        <Button
                          type="submit"
                          variant="ghost"
                          size="sm"
                          className="text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                          disabled={(room.slotCount ?? 0) > 0}
                        >
                          Delete
                        </Button>
                      </form>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
