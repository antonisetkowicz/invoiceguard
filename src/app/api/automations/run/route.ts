import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { runAutomations } from "@/lib/automation-engine";
import type { ApiResponse } from "@/types";

// POST /api/automations/run — evaluate all enabled rules and apply actions.
export async function POST() {
  try {
    const { orgId } = await requireAuth();
    const result = await runAutomations(orgId);
    return NextResponse.json<ApiResponse>({ success: true, data: result });
  } catch {
    return NextResponse.json<ApiResponse>({ success: false, error: "Automation run failed" }, { status: 500 });
  }
}
