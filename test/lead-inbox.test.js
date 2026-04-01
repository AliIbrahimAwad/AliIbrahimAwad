const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildGenericEmailParse,
  classifyParsedEmail,
  createLeadInboxService,
  parseAdfLeadXml,
  parseAutoTraderEmail,
  parseCarGurusEmail,
  parseLeadEmail,
  parseWebsiteLeadEmail,
  shouldSkipParsedEmail,
} = require("../services/leadInbox");

test("parses AutoTrader lead emails", () => {
  const text = `
Source: Auto Trader Mobile
Location: LOOLOO AUTO SALES
Submission Date: 2026-03-14T19:58:06+00:00

Customer Information
Name: ben Unknown
Phone: 6833815831
Email: hartley1911@outlook.com
Comment: Hi, I found your listing on the AutoTrader Android app and would like to know more about the vehicle.

Vehicle Information
Location: LOOLOO AUTO SALES
Stock Number: D9524
Vin: 3C6JB5CT5JG295901
Year: 2018
Make: Ram
Model: 2500
Trim: Tradesman Crew Cab 5.7L 4WD Safety Certified
Price: 25995
Condition: Used
SourceUrl:
`;

  const lead = parseAutoTraderEmail(text, {
    from: {
      emailAddress: {
        address: "1-Source@dealerleads.trader.ca",
      },
    },
  });

  assert.equal(lead.source, "autotrader");
  assert.equal(lead.customer_name, "ben Unknown");
  assert.equal(lead.email, "hartley1911@outlook.com");
  assert.equal(lead.vehicle_id, "3C6JB5CT5JG295901");
  assert.match(lead.vehicle_interest, /Ram 2500/);
});

test("parses inline AutoTrader sales lead emails without swallowing the whole body into the name", () => {
  const text = `
Name: Morgan
Email: morganleighcox@gmail.com
Phone: 6471234567
Subject: Important Sales Lead from AutoTrader.ca
Trade-In?: No
description:
Message Hi, I found your listing on AutoTrader iPhone App and would like to know more about the vehicle. Please send me more information about your 2021 Tesla Model 3 Standard Range Plus.
Dealer Price:
Term Requested:
Finance Rate:
Cash Down: Not specified
Trade In: Not specified
Loan Amount:
Fee: Not specified
Cost of borrowing:
Ad Details Dealer: LOOLOO AUTO SALES
Condition: Used
Stock Number: D9779
Price: $21,995
`;

  const lead = parseAutoTraderEmail(text, {
    from: {
      emailAddress: {
        address: "no-reply@trader.ca",
      },
    },
  });

  assert.equal(lead.source, "autotrader");
  assert.equal(lead.customer_name, "Morgan");
  assert.equal(lead.email, "morganleighcox@gmail.com");
  assert.equal(lead.phone, "6471234567");
  assert.equal(lead.stock_number, "D9779");
  assert.match(lead.message, /would like to know more about the vehicle/i);
  assert.doesNotMatch(lead.customer_name, /autotrader|stock number|dealer price/i);
});

test("parses AutoTrader CARFAX request emails", () => {
  const text = `
A potential customer has viewed your ad on www.autotrader.ca and is requesting a CARFAX Canada report on the vehicle. Please send the CARFAX Canada report to: saifhanoudi11@yahoo.com, Phone: 6479658360.

Your Mercedes-Benz C-Class 2017 (Stock #: D9770) ad:
https://www.autotrader.ca/go/5-69458424

To purchase a CARFAX Canada report, visit:
https://www.carfax.ca/orderform.aspx?vin=55SWF6EB0HU180615&report=claims
`;

  const lead = parseAutoTraderEmail(text, {
    from: {
      emailAddress: {
        address: "no-reply@trader.ca",
      },
    },
  });

  assert.equal(lead.source, "autotrader");
  assert.equal(lead.email, "saifhanoudi11@yahoo.com");
  assert.equal(lead.phone, "6479658360");
  assert.equal(lead.stock_number, "D9770");
  assert.match(lead.vehicle_interest, /Mercedes-Benz C-Class 2017/);
  assert.equal(lead.lead_type, "carfax_request");
});

test("parses CarGurus lead emails", () => {
  const text = `
Lead Submission from CarGurus

Contact:
First Name: Nicholas
Last Name: Stoup
Email: nickpaws@me.com
Telephone: (519) 504-9958
Postal code: M5V 1G8

Comments:
I'm interested in this 2022 Tesla Model 3 and I'd like to know if it's still available.

Listing:
VIN: 5YJ3E1EB6NF126791
Vehicle: 2022 Tesla Model 3 Long Range AWD
Stock Number: D9783
Listed Price: $24,995
View Listing on CarGurus: https://example.com/listing
`;

  const lead = parseCarGurusEmail(text, {
    from: {
      emailAddress: {
        address: "dealer-leads@messages.cargurus.com",
      },
    },
  });

  assert.equal(lead.source, "cargurus");
  assert.equal(lead.customer_name, "Nicholas Stoup");
  assert.equal(lead.phone, "(519) 504-9958");
  assert.equal(lead.vehicle_id, "5YJ3E1EB6NF126791");
  assert.equal(lead.stock_number, "D9783");
});

test("classifies CarGurus phone lead notifications as non-direct intake", () => {
  const text = `<![CDATA[Phone Lead from CarGurus. Caller Id: None, Duration: 1 minutes, 18 seconds]]>`;
  const message = {
    subject: "Phone Lead from CarGurus",
    from: {
      emailAddress: {
        address: "dealer-leads@messages.cargurus.com",
      },
    },
  };

  const lead = parseCarGurusEmail(text, message);

  assert.equal(lead.source, "cargurus");
  assert.equal(lead.lead_type, "phone_lead_event");
  assert.equal(classifyParsedEmail(lead, message, text), "other");
  assert.equal(shouldSkipParsedEmail(lead, message, text), true);
});

test("parses CarGurus ADF XML emails", () => {
  const xml = `<?xml version="1.0" encoding="utf-16"?>
<adf>
  <prospect>
    <id source="leadtype">Email</id>
    <requestdate>2026-03-16T20:37:03+00:00</requestdate>
    <vehicle interest="buy" status="Used">
      <year>2016</year>
      <make>RAM</make>
      <model>2500</model>
      <trim>Laramie Mega Cab 4WD 6.7 Cummins | No Accident | Safety Included</trim>
      <vin>3C6UR5ML5GG359865</vin>
      <stock>D9760</stock>
      <price>34995</price>
      <condition>Used</condition>
    </vehicle>
    <customer>
      <contact>
        <name part="first">Jay</name>
        <name part="last">Peart</name>
        <phone type="voice" preferredcontact="0">5197174814</phone>
        <email preferredcontact="0">jaypeart22@gmail.com</email>
      </contact>
      <comments>I'm interested in this 2016 RAM 2500 and I'd like to know if it's still available.</comments>
    </customer>
    <provider>
      <id source="partner">CarGurus</id>
      <name part="full">CarGurus</name>
      <service>CarGurus</service>
      <url>https://cargurus.i/Mk9ez</url>
    </provider>
  </prospect>
</adf>`;

  const lead = parseAdfLeadXml(xml, {
    subject: "Lead Submission from CarGurus",
    from: {
      emailAddress: {
        address: "dealers_ca@cargurus.com",
      },
    },
  });

  assert.equal(lead.source, "cargurus");
  assert.equal(lead.customer_name, "Jay Peart");
  assert.equal(lead.phone, "5197174814");
  assert.equal(lead.email, "jaypeart22@gmail.com");
  assert.equal(lead.stock_number, "D9760");
  assert.equal(lead.vehicle_id, "3C6UR5ML5GG359865");
  assert.match(lead.vehicle_interest, /2016 RAM 2500/i);
  assert.match(lead.message, /still available/i);
  assert.equal(lead.lead_type, "Email");
});

test("parses website lead emails with split first and last names", () => {
  const html = `
    <div>First Name</div>
    <div>Leslie</div>
    <div>Last Name</div>
    <div>Stoll</div>
    <div>Email</div>
    <div>lesliestoll@ymail.com</div>
    <div>Phone Number</div>
    <div>+15197032668</div>
    <div>This form submitted at: https://loolooauto.ca/start-pre-approval/</div>
  `;

  const lead = parseLeadEmail({
    subject: "New website lead",
    body: {
      contentType: "html",
      content: html,
    },
    from: {
      emailAddress: {
        address: "sales@loolooauto.ca",
      },
    },
  });

  assert.equal(lead.source, "website");
  assert.equal(lead.customer_name, "Leslie Stoll");
  assert.equal(lead.email, "lesliestoll@ymail.com");
  assert.equal(lead.phone, "+15197032668");
});

test("parses website lead emails", () => {
  const html = `
    <div>Full Name</div>
    <div>Oswaldo Corona Lopez</div>
    <div>Email</div>
    <div>oswaldo_cl@hotmail.com</div>
    <div>Phone Number</div>
    <div>+16479145081</div>
    <div>Preferred Contact Method</div>
    <div>Email</div>
    <div>Message</div>
    <div>Just wondering if there is any accidents in this car?</div>
    <div>This form submitted at: https://loolooauto.ca/listing/2021-tesla-model-3-standard-range-plus-d9779/</div>
  `;

  const lead = parseLeadEmail({
    subject: "New website lead",
    body: {
      contentType: "html",
      content: html,
    },
    from: {
      emailAddress: {
        address: "sales@loolooauto.ca",
      },
    },
  });

  assert.equal(lead.source, "website");
  assert.equal(lead.customer_name, "Oswaldo Corona Lopez");
  assert.equal(lead.email, "oswaldo_cl@hotmail.com");
  assert.match(lead.vehicle_interest, /2021 Tesla Model 3 Standard Range Plus/i);
});

test("detects lead source from message metadata and content", () => {
  const message = {
    subject: "Lead Submission from CarGurus",
    body: {
      contentType: "text",
      content: "Lead Submission from CarGurus\nFirst Name: Nicholas",
    },
    from: {
      emailAddress: {
        address: "dealer-leads@messages.cargurus.com",
      },
    },
  };

  const parsed = parseLeadEmail(message);
  assert.equal(parsed.source, "cargurus");
});

test("detects AutoTrader from no-reply trader subjects without relying on dealerleads sender", () => {
  const parsed = parseLeadEmail({
    subject: "Important Sales Lead from AutoTrader.ca",
    body: {
      contentType: "text",
      content: "Name: Vivian Thomas\nEmail: vjohn9286@gmail.com\nStock Number: D9505\nMessage: Interested in the Polestar.",
    },
    from: {
      emailAddress: {
        address: "no-reply@trader.ca",
      },
    },
  });

  assert.equal(parsed.source, "autotrader");
  assert.equal(parsed.email, "vjohn9286@gmail.com");
  assert.equal(parsed.stock_number, "D9505");
});

test("generic email parsing still captures an intake candidate when the format is unknown", () => {
  const message = {
    subject: "Contact us about your Camry",
    body: {
      contentType: "text",
      content:
        "Hello,\nName: Jamie Driver\nPhone: +1 (647) 555-0199\nEmail: jamie@example.com\nStock Number: D9489\nI'm interested in availability.",
    },
    from: {
      emailAddress: {
        name: "Jamie Driver",
        address: "jamie@example.com",
      },
    },
  };

  const parsed = buildGenericEmailParse(message, message.body.content);
  assert.equal(parsed.customer_name, "Jamie Driver");
  assert.equal(parsed.email, "jamie@example.com");
  assert.equal(parsed.stock_number, "D9489");
  assert.equal(classifyParsedEmail(parsed, message, message.body.content), "direct_lead");
});

test("lead inbox importer creates an 'Other' intake item instead of ignoring unknown emails", async () => {
  const importedMessages = [];
  const intakeItems = [];
  const importer = await createLeadInboxService({
    db: {
      async getImportedMessageByExternalId() {
        return null;
      },
      async findLeadDuplicate() {
        return null;
      },
      async createApiLead() {
        throw new Error("Direct lead creation should not run for this email.");
      },
      async createEmailIntakeItem(payload) {
        intakeItems.push(payload);
        return { id: 1, classification: payload.classification, status: payload.status, lead_id: null };
      },
      async recordImportedMessage(payload) {
        importedMessages.push(payload);
        return payload;
      },
    },
    graph: {
      async markProcessed() {},
    },
  });

  const result = await importer.importMessage({
    id: "message-2",
    internetMessageId: "<message-2@example.com>",
    subject: "Vendor invoice question",
    receivedDateTime: "2026-03-22T14:15:00.000Z",
    from: {
      emailAddress: {
        name: "Office Vendor",
        address: "vendor@example.com",
      },
    },
    body: {
      contentType: "text",
      content: "Hello team, I wanted to ask about invoicing and admin setup.",
    },
  });

  assert.equal(result.imported, true);
  assert.equal(intakeItems[0].classification, "other");
  assert.equal(intakeItems[0].status, "open");
  assert.equal(importedMessages[0].matched_reason, "other");
});

test("lead inbox importer normalizes missing customer names to NN Lead", async () => {
  const intakeItems = [];
  const createdLeads = [];
  const importer = await createLeadInboxService({
    db: {
      async getImportedMessageByExternalId() {
        return null;
      },
      async createApiLead(payload) {
        createdLeads.push(payload);
        return { id: 44, customer_name: payload.customer_name, assigned_to: null, inventory_id: null };
      },
      async createEmailIntakeItem(payload) {
        intakeItems.push(payload);
        return payload;
      },
      async recordImportedMessage(payload) {
        return payload;
      },
    },
    graph: {
      async markProcessed() {},
    },
  });

  await importer.importMessage({
    id: "message-3",
    internetMessageId: "<message-3@example.com>",
    subject: "Lead Submission from CarGurus",
    receivedDateTime: "2026-03-26T18:57:02.000Z",
    from: {
      emailAddress: {
        address: "dealer-leads@messages.cargurus.com",
      },
    },
    body: {
      contentType: "text",
      content: `Lead Submission from CarGurus

Contact:
First Name: Name
Last Name: Unknown
Telephone: (902) 322-1405

Listing:
Vehicle: 2018 Tesla Model 3
Stock Number: D9756`,
    },
  });

  assert.equal(createdLeads[0].customer_name, "NN Lead");
  assert.equal(intakeItems[0].customer_name, "NN Lead");
});

test("lead inbox importer skips CarGurus phone lead notifications entirely", async () => {
  const intakeItems = [];
  const importedMessages = [];
  let markProcessedCalls = 0;
  let createdLeadCalls = 0;
  const importer = await createLeadInboxService({
    db: {
      async getImportedMessageByExternalId() {
        return null;
      },
      async createApiLead() {
        createdLeadCalls += 1;
        throw new Error("CarGurus phone lead notifications should not create CRM leads.");
      },
      async createEmailIntakeItem(payload) {
        intakeItems.push(payload);
        return payload;
      },
      async recordImportedMessage(payload) {
        importedMessages.push(payload);
        return payload;
      },
    },
    graph: {
      async markProcessed() {
        markProcessedCalls += 1;
      },
    },
  });

  const result = await importer.importMessage({
    id: "message-cg-phone-1",
    internetMessageId: "<message-cg-phone-1@example.com>",
    subject: "Phone Lead from CarGurus",
    receivedDateTime: "2026-04-01T12:30:00.000Z",
    from: {
      emailAddress: {
        address: "dealer-leads@messages.cargurus.com",
      },
    },
    body: {
      contentType: "text",
      content: "<![CDATA[Phone Lead from CarGurus. Caller Id: None, Duration: 1 minutes, 18 seconds]]>",
    },
  });

  assert.equal(createdLeadCalls, 0);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, "phone_lead_event");
  assert.equal(intakeItems.length, 0);
  assert.equal(markProcessedCalls, 1);
  assert.equal(importedMessages[0].status, "skipped");
  assert.equal(importedMessages[0].matched_reason, "phone_lead_event");
});
