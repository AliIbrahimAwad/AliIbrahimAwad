const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseAutoTraderEmail,
  parseCarGurusEmail,
  parseLeadEmail,
  parseWebsiteLeadEmail,
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
