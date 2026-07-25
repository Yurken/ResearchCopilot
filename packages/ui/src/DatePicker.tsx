"use client";

import { clsx } from "clsx";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

interface DatePickerProps {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  label?: string;
  min?: string;
  max?: string;
  disabled?: boolean;
  className?: string;
}

const weekDays = ["日", "一", "二", "三", "四", "五", "六"];
const months = Array.from({ length: 12 }, (_, index) => index);
type CalendarView = "days" | "months" | "years";

function parseDate(value?: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value?.trim() ?? "");
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
  if (
    date.getFullYear() !== Number(match[1]) ||
    date.getMonth() !== Number(match[2]) - 1 ||
    date.getDate() !== Number(match[3])
  ) {
    return null;
  }
  return date;
}

function formatDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateLabel(date: Date) {
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1, 12);
}

function shiftMonth(date: Date, amount: number) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1, 12);
}

function monthKey(date: Date) {
  return date.getFullYear() * 12 + date.getMonth();
}

function buildCalendarDays(viewMonth: Date) {
  const firstDay = startOfMonth(viewMonth);
  const gridStart = new Date(firstDay);
  gridStart.setDate(firstDay.getDate() - firstDay.getDay());

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    return {
      date,
      value: formatDate(date),
      inCurrentMonth: date.getMonth() === viewMonth.getMonth(),
    };
  });
}

export default function DatePicker({
  value,
  onChange,
  id,
  label,
  min,
  max,
  disabled = false,
  className,
}: DatePickerProps) {
  const generatedId = useId();
  const triggerId = id ?? `${generatedId}-trigger`;
  const labelId = label ? `${triggerId}-label` : undefined;
  const dialogId = `${triggerId}-dialog`;
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [calendarView, setCalendarView] = useState<CalendarView>("days");
  const selectedDate = useMemo(() => parseDate(value), [value]);
  const maxDate = useMemo(() => parseDate(max), [max]);
  const minDate = useMemo(() => parseDate(min), [min]);
  const initialMonth = selectedDate ?? maxDate ?? new Date();
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(initialMonth));
  const calendarDays = useMemo(() => buildCalendarDays(viewMonth), [viewMonth]);
  const today = formatDate(new Date());
  const yearPageStart = Math.floor(viewMonth.getFullYear() / 12) * 12;
  const displayedYears = Array.from({ length: 12 }, (_, index) => yearPageStart + index);
  const canGoPrevious =
    calendarView === "days"
      ? !minDate || monthKey(viewMonth) > monthKey(minDate)
      : calendarView === "months"
        ? !minDate || viewMonth.getFullYear() > minDate.getFullYear()
        : !minDate || yearPageStart > minDate.getFullYear();
  const canGoNext =
    calendarView === "days"
      ? !maxDate || monthKey(viewMonth) < monthKey(maxDate)
      : calendarView === "months"
        ? !maxDate || viewMonth.getFullYear() < maxDate.getFullYear()
        : !maxDate || yearPageStart + 11 < maxDate.getFullYear();

  useEffect(() => {
    if (!open) return;
    setViewMonth(startOfMonth(selectedDate ?? maxDate ?? new Date()));
    setCalendarView("days");

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      window.requestAnimationFrame(() => document.getElementById(triggerId)?.focus());
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [maxDate, open, selectedDate, triggerId]);

  const commitDate = (nextValue: string) => {
    onChange(nextValue);
    setOpen(false);
    window.requestAnimationFrame(() => document.getElementById(triggerId)?.focus());
  };

  const moveCalendar = (direction: -1 | 1) => {
    setViewMonth((current) => {
      if (calendarView === "days") return shiftMonth(current, direction);
      if (calendarView === "months") {
        return new Date(current.getFullYear() + direction, current.getMonth(), 1, 12);
      }
      return new Date(current.getFullYear() + direction * 12, current.getMonth(), 1, 12);
    });
  };

  return (
    <div ref={rootRef} className={clsx("relative w-full", className)}>
      {label ? (
        <label id={labelId} htmlFor={triggerId} className="mb-1.5 ml-1 block text-xs font-medium text-ink-tertiary">
          {label}
        </label>
      ) : null}

      <button
        id={triggerId}
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={dialogId}
        aria-labelledby={labelId}
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center justify-between gap-3 rounded-2xl border px-4 py-2.5 text-sm tabular-nums outline-none transition-[box-shadow,border-color,background-color] duration-150 disabled:cursor-not-allowed disabled:opacity-60"
        style={{
          background: "var(--rc-control-bg)",
          borderColor: open ? "color-mix(in srgb, var(--rc-accent) 42%, transparent)" : "var(--rc-control-border)",
          boxShadow: open ? "var(--rc-control-focus-shadow)" : "var(--rc-control-shadow)",
          color: "var(--rc-text)",
        }}
      >
        <span>{selectedDate ? formatDateLabel(selectedDate) : "选择日期"}</span>
      </button>

      {open ? (
        <div
          id={dialogId}
          role="dialog"
          aria-modal="false"
          aria-labelledby={labelId}
          className="rc-dropdown-menu absolute left-0 top-full z-50 mt-2 w-[19rem] rounded-3xl p-4"
        >
          <div className="mb-3 flex items-center justify-between">
            <button
              type="button"
              className="rc-icon-button h-9 w-9"
              disabled={!canGoPrevious}
              aria-label={calendarView === "days" ? "上一个月" : calendarView === "months" ? "上一年" : "上一组年份"}
              onClick={() => moveCalendar(-1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            {calendarView === "years" ? (
              <p className="text-sm font-semibold tabular-nums text-ink-primary">
                {yearPageStart} – {yearPageStart + 11}
              </p>
            ) : (
              <div className="flex items-center gap-1 rounded-xl p-1" style={{ background: "var(--rc-chip-inset-bg)", boxShadow: "var(--rc-chip-inset-shadow)" }}>
                <button
                  type="button"
                  aria-label={`快速选择年份，当前 ${viewMonth.getFullYear()} 年`}
                  onClick={() => setCalendarView("years")}
                  className="rounded-lg px-2.5 py-1 text-xs font-semibold tabular-nums transition-colors"
                  style={{
                    background: calendarView === "months" ? "transparent" : "var(--rc-chip-bg)",
                    boxShadow: calendarView === "months" ? "none" : "var(--rc-chip-shadow)",
                    color: "var(--rc-text)",
                  }}
                >
                  {viewMonth.getFullYear()} 年
                </button>
                <button
                  type="button"
                  aria-label={`快速选择月份，当前 ${viewMonth.getMonth() + 1} 月`}
                  onClick={() => setCalendarView("months")}
                  className="rounded-lg px-2.5 py-1 text-xs font-semibold tabular-nums transition-colors"
                  style={{
                    background: calendarView === "months" ? "var(--rc-chip-bg)" : "transparent",
                    boxShadow: calendarView === "months" ? "var(--rc-chip-shadow)" : "none",
                    color: "var(--rc-text)",
                  }}
                >
                  {viewMonth.getMonth() + 1} 月
                </button>
              </div>
            )}
            <button
              type="button"
              className="rc-icon-button h-9 w-9"
              disabled={!canGoNext}
              aria-label={calendarView === "days" ? "下一个月" : calendarView === "months" ? "下一年" : "下一组年份"}
              onClick={() => moveCalendar(1)}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          {calendarView === "years" ? (
            <div className="grid grid-cols-3 gap-2" role="grid" aria-label="年份">
              {displayedYears.map((year) => {
                const active = year === viewMonth.getFullYear();
                const outsideRange = Boolean(
                  (minDate && year < minDate.getFullYear()) ||
                  (maxDate && year > maxDate.getFullYear()),
                );
                return (
                  <button
                    key={year}
                    type="button"
                    role="gridcell"
                    aria-label={`${year} 年`}
                    aria-selected={active}
                    disabled={outsideRange}
                    onClick={() => {
                      setViewMonth((current) => new Date(year, current.getMonth(), 1, 12));
                      setCalendarView("months");
                    }}
                    className="rounded-xl px-3 py-2.5 text-xs font-semibold tabular-nums outline-none transition-[transform,box-shadow,background-color] duration-150 hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-apple-blue/40 disabled:cursor-not-allowed disabled:opacity-25 disabled:hover:translate-y-0"
                    style={{
                      background: active ? "var(--rc-info-chip-bg)" : "var(--rc-chip-bg)",
                      boxShadow: active ? "var(--rc-chip-inset-shadow)" : "var(--rc-chip-shadow)",
                      color: active ? "var(--rc-info-chip-text)" : "var(--rc-text-soft)",
                    }}
                  >
                    {year}
                  </button>
                );
              })}
            </div>
          ) : calendarView === "months" ? (
            <div className="grid grid-cols-3 gap-2" role="grid" aria-label="月份">
              {months.map((month) => {
                const currentMonthKey = viewMonth.getFullYear() * 12 + month;
                const active = month === viewMonth.getMonth();
                const outsideRange = Boolean(
                  (minDate && currentMonthKey < monthKey(minDate)) ||
                  (maxDate && currentMonthKey > monthKey(maxDate)),
                );
                return (
                  <button
                    key={month}
                    type="button"
                    role="gridcell"
                    aria-label={`${month + 1} 月`}
                    aria-selected={active}
                    disabled={outsideRange}
                    onClick={() => {
                      setViewMonth((current) => new Date(current.getFullYear(), month, 1, 12));
                      setCalendarView("days");
                    }}
                    className="rounded-xl px-3 py-2.5 text-xs font-semibold tabular-nums outline-none transition-[transform,box-shadow,background-color] duration-150 hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-apple-blue/40 disabled:cursor-not-allowed disabled:opacity-25 disabled:hover:translate-y-0"
                    style={{
                      background: active ? "var(--rc-info-chip-bg)" : "var(--rc-chip-bg)",
                      boxShadow: active ? "var(--rc-chip-inset-shadow)" : "var(--rc-chip-shadow)",
                      color: active ? "var(--rc-info-chip-text)" : "var(--rc-text-soft)",
                    }}
                  >
                    {month + 1} 月
                  </button>
                );
              })}
            </div>
          ) : (
          <div className="grid grid-cols-7 gap-1" role="grid" aria-label="日期">
            {weekDays.map((day) => (
              <span key={day} role="columnheader" className="py-1 text-center text-[11px] font-semibold text-ink-tertiary">
                {day}
              </span>
            ))}
            {calendarDays.map((cell) => {
              const isSelected = cell.value === value;
              const isToday = cell.value === today;
              const isOutsideRange = Boolean((min && cell.value < min) || (max && cell.value > max));

              return (
                <button
                  key={cell.value}
                  type="button"
                  role="gridcell"
                  aria-label={formatDateLabel(cell.date)}
                  aria-selected={isSelected}
                  aria-current={isToday ? "date" : undefined}
                  disabled={isOutsideRange}
                  onClick={() => commitDate(cell.value)}
                  className={clsx(
                    "flex h-9 w-9 items-center justify-center rounded-xl text-xs tabular-nums outline-none transition-[transform,box-shadow,background-color,color] duration-150",
                    "hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-apple-blue/40",
                    !cell.inCurrentMonth && "opacity-45",
                    isOutsideRange && "cursor-not-allowed opacity-25 hover:translate-y-0",
                    !isSelected && !isToday && "hover:bg-[var(--rc-info-chip-bg)]",
                  )}
                  style={
                    isSelected
                      ? {
                          background: "var(--rc-button-primary-bg)",
                          boxShadow: "var(--rc-button-primary-shadow)",
                          color: "var(--rc-button-primary-text)",
                          fontWeight: 700,
                        }
                      : isToday
                        ? {
                            background: "var(--rc-info-chip-bg)",
                            color: "var(--rc-info-chip-text)",
                            fontWeight: 700,
                          }
                        : { color: "var(--rc-text-soft)" }
                  }
                >
                  {cell.date.getDate()}
                </button>
              );
            })}
          </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
