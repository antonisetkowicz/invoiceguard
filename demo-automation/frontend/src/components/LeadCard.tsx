import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, Loader2, Mail, MessageSquare, Sparkles } from "lucide-react";
import type { Lead } from "../lib/api";
import { ScoreBadge } from "./ScoreBadge";

interface LeadCardProps {
  lead: Lead;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

export function LeadCard({ lead }: LeadCardProps) {
  const [expanded, setExpanded] = useState(false);
  const isProcessing = lead.status !== "qualified" || lead.qualified_score === null;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -16, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur-xl transition-colors hover:border-white/20"
    >
      <div
        className={`pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent ${
          isProcessing ? "via-cyan-400/60" : "via-violet-400/60"
        } to-transparent`}
      />

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-base font-semibold text-white">{lead.name}</h3>
            {lead.company && (
              <span className="truncate rounded-md bg-white/5 px-2 py-0.5 text-xs text-white/50">
                {lead.company}
              </span>
            )}
          </div>
          <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-white/40">
            <Mail size={12} />
            {lead.email}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <ScoreBadge score={lead.qualified_score} />
          <span className="text-[11px] text-white/30">{formatTime(lead.created_at)}</span>
        </div>
      </div>

      <p className="mt-4 flex items-start gap-2 text-sm leading-relaxed text-white/70">
        <MessageSquare size={14} className="mt-0.5 shrink-0 text-white/30" />
        <span className="line-clamp-2">{lead.message}</span>
      </p>

      {isProcessing ? (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5 text-xs text-cyan-300">
          <Loader2 size={14} className="animate-spin" />
          <span>Claude analizuje leada i przygotowuje odpowiedź…</span>
          <div className="ml-auto h-2 w-24 overflow-hidden rounded-full bg-white/5">
            <div className="h-full w-full animate-shimmer" />
          </div>
        </div>
      ) : (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5 text-left text-xs font-medium text-white/70 transition-colors hover:bg-white/[0.05]"
          >
            <span className="flex items-center gap-2">
              <Sparkles size={14} className="text-violet-300" />
              Odpowiedź wygenerowana przez AI
            </span>
            <ChevronDown
              size={16}
              className={`text-white/40 transition-transform ${expanded ? "rotate-180" : ""}`}
            />
          </button>
          <AnimatePresence initial={false}>
            {expanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.25, ease: "easeInOut" }}
                className="overflow-hidden"
              >
                <p className="mt-2 rounded-xl bg-gradient-to-br from-violet-500/10 to-cyan-500/10 p-3 text-sm leading-relaxed text-white/85 ring-1 ring-inset ring-white/10">
                  {lead.ai_response}
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </motion.div>
  );
}
