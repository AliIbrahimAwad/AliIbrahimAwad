const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { Client } = require("basic-ftp");

const { ValidationError } = require("../src/data/core");

function buildPatternMatcher(pattern) {
  if (!pattern) {
    return () => true;
  }

  try {
    const regex = new RegExp(pattern, "i");
    return (value) => regex.test(String(value || ""));
  } catch (_error) {
    const normalizedPattern = String(pattern || "").trim().toLowerCase();
    return (value) => String(value || "").trim().toLowerCase().includes(normalizedPattern);
  }
}

function normalizeRemoteFile(item = {}, directory = ".") {
  return {
    name: String(item.name || "").trim(),
    path: path.posix.join(directory || ".", String(item.name || "").trim()),
    modifiedAt: item.modifiedAt ? new Date(item.modifiedAt) : null,
    isFile: item.isFile !== false && item.type !== 2,
    size: Number(item.size || 0),
  };
}

class InventoryFtpClient {
  constructor(config = {}, options = {}) {
    this.config = config;
    this.clientFactory = options.clientFactory || (() => new Client());
  }

  async withClient(run) {
    const client = this.clientFactory();
    client.ftp.verbose = false;

    await client.access({
      host: this.config.host,
      port: this.config.port || 21,
      user: this.config.user,
      password: this.config.password,
      secure: Boolean(this.config.secure),
    });

    try {
      return await run(client);
    } finally {
      client.close();
    }
  }

  async listFiles() {
    return this.withClient(async (client) => {
      if (this.config.remoteDirectory) {
        await client.cd(this.config.remoteDirectory);
      }

      const items = await client.list();
      return items.map((item) => normalizeRemoteFile(item, this.config.remoteDirectory));
    });
  }

  selectLatestFile(files = [], now = new Date()) {
    const matcher = buildPatternMatcher(this.config.filePattern);
    const preferredName = String(this.config.preferredFileName || "").trim().toLowerCase();
    const minimumModifiedTime = now.getTime() - Number(this.config.stableFileAgeMs || 0);

    const candidates = files
      .filter((file) => file.isFile && file.name)
      .filter((file) => (!preferredName ? true : file.name.toLowerCase() === preferredName))
      .filter((file) => matcher(file.name))
      .filter((file) => !file.modifiedAt || file.modifiedAt.getTime() <= minimumModifiedTime)
      .sort((left, right) => {
        const leftTime = left.modifiedAt ? left.modifiedAt.getTime() : 0;
        const rightTime = right.modifiedAt ? right.modifiedAt.getTime() : 0;
        if (leftTime !== rightTime) {
          return rightTime - leftTime;
        }

        return right.name.localeCompare(left.name);
      });

    if (!candidates.length) {
      throw new ValidationError("No stable inventory file matched the FTP selection rules.");
    }

    return candidates[0];
  }

  async downloadFile(remoteFile) {
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "crm-inventory-ftp-"));
    const localPath = path.join(tempDirectory, remoteFile.name);

    await this.withClient(async (client) => {
      if (this.config.remoteDirectory) {
        await client.cd(this.config.remoteDirectory);
      }

      await client.downloadTo(localPath, remoteFile.name);
    });

    return {
      ...remoteFile,
      localPath,
      tempDirectory,
    };
  }

  async fetchLatestFile() {
    const files = await this.listFiles();
    const selected = this.selectLatestFile(files);
    return this.downloadFile(selected);
  }
}

module.exports = {
  InventoryFtpClient,
};
