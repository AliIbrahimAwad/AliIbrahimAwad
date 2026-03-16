const DEFAULT_DEALERSHIP_ID = 1;

function getDefaultDealershipId() {
  const raw = Number(process.env.DEFAULT_DEALERSHIP_ID || DEFAULT_DEALERSHIP_ID);
  return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_DEALERSHIP_ID;
}

module.exports = {
  DEFAULT_DEALERSHIP_ID,
  getDefaultDealershipId,
};
