const { startServer } = require("./app");

const port = Number(process.env.PORT) || 3000;

startServer({ port }).catch((error) => {
  console.error("Failed to start CRM server.", error);
  process.exit(1);
});
