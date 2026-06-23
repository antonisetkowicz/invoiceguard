import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const org = await prisma.organization.create({
    data: { name: "Demo Corp", plan: "pro" },
  });

  await prisma.user.create({
    data: {
      email: "demo@invoiceguard.com",
      passwordHash: await bcrypt.hash("demo1234", 12),
      name: "Demo User",
      role: "admin",
      organizationId: org.id,
    },
  });

  const vendors = [
    "AWS Cloud Services",
    "Google Workspace",
    "Salesforce Inc",
    "HubSpot Marketing",
    "Slack Technologies",
    "Adobe Creative",
    "Zoom Communications",
    "Microsoft Azure",
    "Atlassian Jira",
    "Datadog Monitoring",
  ];

  const invoices = [];
  for (let month = 1; month <= 12; month++) {
    for (const vendor of vendors) {
      const baseAmount = 1000 + Math.random() * 9000;
      invoices.push({
        invoiceNumber: `INV-2025-${String(month).padStart(2, "0")}-${vendor.slice(0, 3).toUpperCase()}-${Math.floor(Math.random() * 1000)}`,
        vendorName: vendor,
        amount: Math.round(baseAmount * 100) / 100,
        issueDate: new Date(2025, month - 1, 1 + Math.floor(Math.random() * 28)),
        dueDate: new Date(2025, month, 1 + Math.floor(Math.random() * 28)),
        category: ["SaaS", "Infrastructure", "Marketing", "Communication", "DevOps"][Math.floor(Math.random() * 5)],
        status: "pending",
        organizationId: org.id,
      });
    }
  }

  const dupVendor = "AWS Cloud Services";
  const dupAmount = 4999.99;
  const dupDate = new Date(2025, 5, 15);
  invoices.push({
    invoiceNumber: "INV-2025-06-AWS-DUPLICATE",
    vendorName: dupVendor,
    amount: dupAmount,
    issueDate: dupDate,
    dueDate: new Date(2025, 6, 15),
    category: "Infrastructure",
    status: "pending",
    organizationId: org.id,
  });
  invoices.push({
    invoiceNumber: "INV-2025-06-AWS-DUP2",
    vendorName: "AWS Cloud  Services",
    amount: dupAmount,
    issueDate: new Date(2025, 5, 18),
    dueDate: new Date(2025, 6, 18),
    category: "Infrastructure",
    status: "pending",
    organizationId: org.id,
  });

  invoices.push({
    invoiceNumber: "INV-2025-07-GOOG-SPIKE",
    vendorName: "Google Workspace",
    amount: 89999.99,
    issueDate: new Date(2025, 6, 10),
    dueDate: new Date(2025, 7, 10),
    category: "SaaS",
    status: "pending",
    organizationId: org.id,
  });

  await prisma.invoice.createMany({ data: invoices });

  console.log(`Seeded: 1 org, 1 user, ${invoices.length} invoices`);
  console.log("Demo login: demo@invoiceguard.com / demo1234");
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
