export interface CheckoutInput {
  readonly orderId: string;
  readonly items: number;
  readonly customerTier: "standard" | "priority";
}

export interface CheckoutResult {
  readonly orderId: string;
  readonly confirmationId: string;
  readonly chargedCents: number;
  readonly fraudScore: number;
  readonly packedItems: number;
}

export interface NotificationInput {
  readonly incidentId: string;
  readonly recipients: readonly string[];
}

export interface NotificationResult {
  readonly incidentId: string;
  readonly delivered: number;
  readonly failed: number;
}

export async function calculateFraudScore(input: CheckoutInput): Promise<number> {
  "use step";
  await delay(input.customerTier === "priority" ? 8 : 15);
  return Math.min(99, input.items * 7 + input.orderId.length);
}

export async function chargeOrder(input: CheckoutInput, fraudScore: number): Promise<number> {
  "use step";
  await delay(12);
  const baseCents = input.items * 1299;
  return fraudScore > 70 ? Math.round(baseCents * 1.03) : baseCents;
}

export async function packShipment(input: CheckoutInput): Promise<number> {
  "use step";
  await delay(input.items * 3);
  return input.items;
}

export async function checkoutWorkflow(input: CheckoutInput): Promise<CheckoutResult> {
  "use workflow";
  const fraudScore = await calculateFraudScore(input);
  const [chargedCents, packedItems] = await Promise.all([
    chargeOrder(input, fraudScore),
    packShipment(input),
  ]);
  const confirmationId = `compiled-${input.orderId}-${fraudScore.toString(36)}`;

  return {
    orderId: input.orderId,
    confirmationId,
    chargedCents,
    fraudScore,
    packedItems,
  };
}

export async function deliverNotification(
  incidentId: string,
  recipient: string,
): Promise<"delivered" | "failed"> {
  "use step";
  await delay(5 + (recipient.length % 4));
  return (incidentId.length + recipient.length) % 11 === 0 ? "failed" : "delivered";
}

export async function notificationWorkflow(input: NotificationInput): Promise<NotificationResult> {
  "use workflow";
  const settled = await Promise.allSettled(
    input.recipients.map(
      async (recipient) => await deliverNotification(input.incidentId, recipient),
    ),
  );
  const delivered = settled.filter(
    (item) => item.status === "fulfilled" && item.value === "delivered",
  ).length;

  return {
    incidentId: input.incidentId,
    delivered,
    failed: settled.length - delivered,
  };
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
