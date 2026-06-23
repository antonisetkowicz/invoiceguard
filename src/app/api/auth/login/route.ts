import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { verifyPassword, createSession } from "@/lib/auth";
import type { ApiResponse } from "@/types";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const data = loginSchema.parse(body);

    const user = await prisma.user.findUnique({
      where: { email: data.email },
      include: { organization: true },
    });

    if (!user || !(await verifyPassword(data.password, user.passwordHash))) {
      return NextResponse.json<ApiResponse>({ success: false, error: "Invalid email or password" }, { status: 401 });
    }

    await createSession(user.id, user.organizationId);

    return NextResponse.json<ApiResponse>({
      success: true,
      data: { id: user.id, email: user.email, name: user.name, organization: user.organization.name },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json<ApiResponse>({ success: false, error: error.errors[0].message }, { status: 400 });
    }
    return NextResponse.json<ApiResponse>({ success: false, error: "Login failed" }, { status: 500 });
  }
}
