import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import type { ApiResponse } from "@/types";

export async function GET() {
  try {
    const { user } = await requireAuth();
    return NextResponse.json<ApiResponse>({
      success: true,
      data: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        organization: user.organization,
      },
    });
  } catch {
    return NextResponse.json<ApiResponse>({ success: false, error: "Not authenticated" }, { status: 401 });
  }
}
