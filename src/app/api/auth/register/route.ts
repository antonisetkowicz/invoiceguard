import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { hashPassword, createSession } from "@/lib/auth";
import type { ApiResponse } from "@/types";

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1),
  organizationName: z.string().min(1),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const data = registerSchema.parse(body);

    const existing = await prisma.user.findUnique({ where: { email: data.email } });
    if (existing) {
      return NextResponse.json<ApiResponse>({ success: false, error: "Email already registered" }, { status: 409 });
    }

    const org = await prisma.organization.create({
      data: { name: data.organizationName },
    });

    const user = await prisma.user.create({
      data: {
        email: data.email,
        passwordHash: await hashPassword(data.password),
        name: data.name,
        role: "admin",
        organizationId: org.id,
      },
    });

    await createSession(user.id, org.id);

    return NextResponse.json<ApiResponse>({
      success: true,
      data: { id: user.id, email: user.email, name: user.name, organization: org.name },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json<ApiResponse>({ success: false, error: error.errors[0].message }, { status: 400 });
    }
    return NextResponse.json<ApiResponse>({ success: false, error: "Registration failed" }, { status: 500 });
  }
}
