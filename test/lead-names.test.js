const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildCustomerNameFromParts,
  normalizeLeadCustomerName,
  splitCustomerNameParts,
} = require("../src/utils/leadNames");

test("keeps only the available last name when first name is missing", () => {
  assert.equal(buildCustomerNameFromParts("", "Stoll", "NN Lead"), "Stoll");
});

test("returns NN Lead when both first and last name are missing", () => {
  assert.equal(buildCustomerNameFromParts("", "", "NN Lead"), "NN Lead");
});

test("treats placeholder tokens as missing name parts", () => {
  assert.equal(buildCustomerNameFromParts("Unknown", "-", "NN Lead"), "NN Lead");
  assert.equal(normalizeLeadCustomerName("Name Unknown", "NN Lead"), "NN Lead");
  assert.equal(normalizeLeadCustomerName("Sam Unknown", "NN Lead"), "Sam");
});

test("deduplicates repeated full names before splitting", () => {
  assert.deepEqual(splitCustomerNameParts("Ryan wilson Ryan wilson"), {
    firstName: "Ryan",
    lastName: "wilson",
  });
});

test("keeps NN Lead editable as blank first and last name fields", () => {
  assert.deepEqual(splitCustomerNameParts("NN Lead"), {
    firstName: "",
    lastName: "",
  });
});
