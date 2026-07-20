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

  // ── Dropshipping AI Automation demo data ──────────────────────
  const supAlpha = await prisma.supplier.create({
    data: { name: "ShenzhenPrime Co.", country: "CN", avgShippingDays: 12, rating: 4.6, reliability: 0.94, organizationId: org.id },
  });
  const supBeta = await prisma.supplier.create({
    data: { name: "GlobalDrop Direct", country: "CN", avgShippingDays: 20, rating: 3.1, reliability: 0.72, organizationId: org.id },
  });
  const supGamma = await prisma.supplier.create({
    data: { name: "EU FastFulfil", country: "PL", avgShippingDays: 4, rating: 4.8, reliability: 0.97, organizationId: org.id },
  });

  const productSeed = [
    { name: "Portable Mini Blender Pro", category: "Kitchen", supplierPrice: 8.5, shippingCost: 3.0, sellingPrice: 34.99, stock: 120, status: "winner", supplierId: supGamma.id, aiScore: 82, aiVerdict: "Winner" },
    { name: "LED Sunset Projection Lamp", category: "Home Decor", supplierPrice: 5.2, shippingCost: 2.4, sellingPrice: 29.99, stock: 60, status: "active", supplierId: supAlpha.id, aiScore: 78, aiVerdict: "Winner" },
    { name: "Posture Corrector Belt", category: "Health", supplierPrice: 4.1, shippingCost: 2.0, sellingPrice: 24.99, stock: 8, status: "active", supplierId: supAlpha.id, aiScore: 64, aiVerdict: "Promising" },
    { name: "Magnetic Phone Mount", category: "Accessories", supplierPrice: 3.0, shippingCost: 1.5, sellingPrice: 9.99, stock: 200, status: "active", supplierId: supBeta.id, aiScore: 41, aiVerdict: "Risky" },
    { name: "Heavy Steel Garden Statue", category: "Garden", supplierPrice: 42.0, shippingCost: 28.0, sellingPrice: 79.99, stock: 15, status: "draft", supplierId: supBeta.id, aiScore: 28, aiVerdict: "Avoid" },
    { name: "Pet Hair Remover Roller", category: "Pet", supplierPrice: 3.8, shippingCost: 2.2, sellingPrice: 19.99, stock: 5, status: "active", supplierId: supGamma.id, aiScore: 71, aiVerdict: "Promising" },
  ];

  const createdProducts = [];
  for (const p of productSeed) {
    createdProducts.push(
      await prisma.product.create({
        data: {
          ...p,
          aiReasons: JSON.stringify([
            `$${p.sellingPrice.toFixed(2)} price point evaluated for impulse buying`,
            `${Math.round(((p.sellingPrice - p.supplierPrice - p.shippingCost) / p.sellingPrice) * 100)}% gross margin`,
          ]),
          aiSource: "heuristic",
          aiGeneratedAt: new Date(),
          organizationId: org.id,
        },
      })
    );
  }

  const orderSeed = [
    { product: createdProducts[0], customer: "Emma Johnson", qty: 1, status: "new" },
    { product: createdProducts[0], customer: "Liam Smith", qty: 2, status: "paid" },
    { product: createdProducts[1], customer: "Olivia Brown", qty: 1, status: "shipped" },
    { product: createdProducts[2], customer: "Noah Davis", qty: 1, status: "new" },
    { product: createdProducts[5], customer: "Ava Wilson", qty: 3, status: "delivered" },
  ];
  for (let i = 0; i < orderSeed.length; i++) {
    const o = orderSeed[i];
    await prisma.order.create({
      data: {
        orderNumber: `ORD-${1000 + i}`,
        customerName: o.customer,
        customerEmail: o.customer.toLowerCase().replace(" ", ".") + "@example.com",
        productId: o.product.id,
        quantity: o.qty,
        salePrice: Math.round(o.product.sellingPrice * o.qty * 100) / 100,
        cost: Math.round((o.product.supplierPrice + o.product.shippingCost) * o.qty * 100) / 100,
        status: o.status,
        organizationId: org.id,
      },
    });
  }

  await prisma.automationRule.createMany({
    data: [
      { name: "Auto-fulfill paid orders", trigger: "new_order", threshold: 0, action: "auto_fulfill", organizationId: org.id },
      { name: "Pause low-margin products", trigger: "low_margin", threshold: 0.3, action: "pause_product", organizationId: org.id },
      { name: "Restock alert on low stock", trigger: "low_stock", threshold: 10, action: "restock_alert", organizationId: org.id },
      { name: "Promote winning products", trigger: "high_score", threshold: 75, action: "tag_winner", organizationId: org.id },
      { name: "Flag risky suppliers", trigger: "supplier_risk", threshold: 3.5, action: "flag", enabled: false, organizationId: org.id },
    ],
  });

  console.log(`Seeded: 1 org, 1 user, ${invoices.length} invoices`);
  console.log(`Dropshipping: 3 suppliers, ${createdProducts.length} products, ${orderSeed.length} orders, 5 automation rules`);
  console.log("Demo login: demo@invoiceguard.com / demo1234");
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
