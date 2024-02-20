const fs = require("fs");
const nodemailer = require("nodemailer");
const config = require("./config");
const path = require("path");
const async = require("async");

const leadsPath = "leads.txt";
const SuccessPath = "success.txt";
const FailedPath = "failed.txt";
const RemainingPath = "remaining.txt";

const successGroups = [];
const failedGroups = [];
const successRecipients = [];
const failedRecipients = [];

function readFileSync(filePath) {
  try {
    const data = fs.readFileSync(filePath, "utf8");
    const newData = data.split("\n");
    const fileData = [];
    for (let i = 0; i < newData.length; i++) {
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newData[i])) {
        fileData.push(newData[i]);
      }
    }
    return fileData;
  } catch (err) {
    console.error("Error reading file:", err);
    return [];
  }
}
function getHost(email) {
  const m = /[^@]+@([\w\d\-\.]+)/.exec(email);
  return m && m[1];
}

function groupRecipients(recipients) {
  let groups = {};
  let host;
  const recipients_length = recipients.length;
  for (let i = 0; i < recipients_length; i++) {
    host = getHost(recipients[i]);
    (groups[host] || (groups[host] = [])).push(recipients[i]);
  }
  return groups;
}

if (!config?.smtps?.length > 0) {
  throw new Error("at least one smtp is required");
}

console.log("------------------------------------------------------------\n\n[*] => SMTP's Loaded...\n\n");
console.log("[*] => Loading leads...\n");
const getLeadsFileData = readFileSync(leadsPath);
if (getLeadsFileData.length <= 0) {
  throw new Error("save send leads to 'leads.txt' file");
}

console.log(`\n[*] => ${getLeadsFileData.length} leads loaded\n`);

const groups = groupRecipients(getLeadsFileData);

function getMessageText() {
  if (config.randomizeMessage && config.messages.length > 2) {
    const getMessage = config.messages[Math.floor(Math.random() * config.messages.length)];
    return getMessage;
  }
  return config.messages[0];
}

function getTransport() {
  let getSmtp;
  if (config.randomizeSmtps && config.smtps.length >= 2) {
    console.log("[*] => Randomizing SMTP...\n");
    getSmtp = config.smtps[Math.floor(Math.random() * config.smtps.length)];
    console.log(getSmtp.port);
    return [
      nodemailer.createTransport({
        host: getSmtp.host,
        port: getSmtp.port,
        auth: {
          user: getSmtp.username,
          pass: getSmtp.password,
        },
        requireTLS: true,

        tls: {
          maxVersion: "TLSv1.3",
          minVersion: "TLSv1.2",
          ciphers: "TLS_AES_128_GCM_SHA256",
        },
      }),
      getSmtp,
    ];
  } else {
    console.log("[*] => Selecting smtp...\n");
    getSmtp = config.smtps[0];
    return [
      nodemailer.createTransport({
        host: getSmtp.host,
        port: getSmtp.port,
        auth: {
          user: getSmtp.username,
          pass: getSmtp.password,
        },
        requireTLS: true,

        tls: {
          maxVersion: "TLSv1.3",
          minVersion: "TLSv1.2",
          ciphers: "TLS_AES_128_GCM_SHA256",
        },
      }),
      getSmtp,
    ];
  }
}

function sendMessages(groups, recipients, config) {
  var self = this;
  self.config = config;

  self.initReporting();
  if (config.bulkSend) {
    self.sendAsGroups(groups);
  } else {
    self.parallelSend(recipients);
  }
}

sendMessages.prototype.initReporting = function () {
  var self = this;
  ["success.txt", "failed.txt", "remaining.txt"].forEach((f) => {
    const directory = path.dirname(f);
    if (!fs.existsSync(directory)) {
      fs.mkdirSync(directory, { recursive: true });
    }
  });
};
sendMessages.prototype.sendAsGroups = function (groups) {
  var self = this;
  let count = 0;
  async.eachLimit(
    Object.values(groups),
    5,
    async function (recipients, callback) {
      await self.sendMessage(recipients, function () {});
      const host = Object.keys(groups);
      const getHost = host[count];
      count++;
      //   self.getTransport();
      // save remaining
      delete groups[getHost];
      const remainingAsArrays = Object.values(groups);
      fs.writeFile(RemainingPath, "", "utf8");
      for (let arr of remainingAsArrays) {
        fs.appendFile(RemainingPath, arr.join("\n"), "utf8");
      }
      callback();
    },
    function () {}
  );
};
sendMessages.prototype.parallelSend = function (recipients) {
  var self = this;
  var count = 0;
  async.eachLimit(
    recipients,
    5,
    async function (recipient, callback) {
      await self.sendMessage(recipient, function () {});
      const remaining = recipients.slice(recipients.indexOf(recipient) + 1);
      const joinRem = remaining.join("\n");
      if (remaining.length >= 1) {
        fs.writeFileSync(RemainingPath, joinRem);
      }
      callback();
    },
    function () {}
  );
};
sendMessages.prototype.sendMessage = function (recipients, callback) {
  var self = this;
  let status;
  const [activeTransport, activeSmtp] = getTransport();
  async.waterfall(
    [
      function (callback) {
        const mailOptions = {
          from: self.config?.fromName || activeSmtp?.username,
          to: recipients,
          subject: "Test Send mail",
          text: getMessageText(),
        };
        let isGroup;
        activeTransport.sendMail(mailOptions, function (error, info) {
          if (error) {
            status = false;
            console.log("[*] =>  %s\n", String(error).trim());
            if (typeof recipients === Array) {
              failedGroups.concat(recipients);
              isGroup = true;
            } else {
              failedRecipients.push(recipients);
            }
          } else {
            status = true;
            if (typeof recipients === Array) {
              successGroups.concat(recipients);
              isGroup = true;
            } else {
              successRecipients.push(recipients);
            }
          }
          callback(null, status, recipients, isGroup);
        });
      },
      function (statusCode, recipients, isGroup, callback) {
        if (isGroup) {
          const splitContacts = recipients.join("\n");
          if (statusCode) {
            fs.appendFile(SuccessPath, splitContacts, "utf8");
            recipients.forEach((r, i) =>
              setTimeout(() => {
                console.log("[*] => Message sent to %s successfully", r);
              }, i * 1000)
            );
          } else {
            fs.appendFile(FailedPath, splitContacts, "utf8");
            recipients.forEach((r, i) =>
              setTimeout(() => {
                console.log("[*] => Message send FAILED -> %s\n", r);
              }, i * 1000)
            );
          }
        } else {
          if (statusCode) {
            console.log("[*] => Message sent to %s successfully", recipients);
            fs.appendFile(SuccessPath, `${recipients}\n`, () => {});
          } else {
            console.log("[*] => Message send FAILED -> %s\n", recipients);
            fs.appendFile(FailedPath, `${recipients}\n`, () => {});
          }
        }
        callback(null);
      },
    ],
    function () {
      //   console.log("final op");
      callback();
    }
  );
};

new sendMessages(groups, getLeadsFileData, config);
