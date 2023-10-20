const express = require("express");
const fs = require("fs");
const cors = require("cors");
const https = require("https");
const axios = require("axios");
const { sign } = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const bodyParser = require("body-parser");
const { v4: uuidv4 } = require("uuid");
const path = require("path");
const dotenv = require("dotenv");

const config = require("./config.json");
const ver = config.version;
let badNames = config.badNames;

let users = require("./data/users.json");
let userArray = [];
let shopArray = [];

const { request } = require("http");
const {
  logError,
  logTransaction,
  logEvent,
  logPurchase,
  setupLog,
} = require("./modules/logger.js");

require("dotenv").config();

const purchaseHook = process.env.PURCHASE_HOOK;

var ipRequestCache = {};

function isRequestAllowed(ip) {
  const currentTime = Date.now();
  const timeWindowMs = 10 * 1000; // 10 sec
  const maxRequests = 15;
  const blockDurationMs = 60 * 1000; // 1 minute

  if (!ipRequestCache[ip]) {
    ipRequestCache[ip] = {
      count: 0,
      lastRequest: currentTime,
    };
  }

  const cacheEntry = ipRequestCache[ip];
  if (currentTime - cacheEntry.lastRequest > blockDurationMs) {
    // Ok to reset
    cacheEntry.count = 0;
  }

  if (
    currentTime - cacheEntry.lastRequest < timeWindowMs &&
    cacheEntry.count >= maxRequests
  ) {
    // exceeded the max requests
    // return time until resource can be accessed again in miliseconds
    const timeLeft = cacheEntry.lastRequest + blockDurationMs - currentTime;
    return timeLeft > 0 ? timeLeft : 0;
  }

  cacheEntry.count++;
  cacheEntry.lastRequest = currentTime;
  return 0;
}

const credentials = {
  key: fs.readFileSync(config.keys.privateKey, "utf8"),
  cert: fs.readFileSync(config.keys.certificate, "utf8"),
  ca: fs.readFileSync(config.keys.ca, "utf8"),
};

class User {
  constructor(
    name,
    id,
    admin,
    Shekels,
    email,
    discordID,
    displayName,
    discordInfo,
    discordGuilds,
    discordToken,
    tokens,
    logonCode,
    logonCodeExpires,
    items,
    visits
  ) {
    this.name = name;
    this.id = id;
    this.admin = admin;
    this.Shekels = Shekels;
    this.email = email;
    this.discordID = discordID;
    this.displayName = displayName;
    this.discordInfo = discordInfo;
    this.discordGuilds = discordGuilds;
    this.discordToken = discordToken;
    this.tokens = tokens;
    this.logonCode = logonCode;
    this.logonCodeExpires = logonCodeExpires;
    this.items = items;
    this.visits = visits;
  }
}

class PublicUser {
  constructor(name, id, Shekels, gradYear, discordLinked, displayName) {
    this.name = name;
    this.id = id;
    this.shekels = Shekels;
    this.graduation_year = parseInt(gradYear);
    this.discord_linked = discordLinked;
    this.displayName = displayName;
  }
}

class UserManager {
  constructor() {
    this.users = [];
    this.loadUsers();
  }

  loadUsers() {
    const json = JSON.parse(fs.readFileSync("./data/users.json"));
    this.users = json.map(
      (user) =>
        new User(
          user.name,
          user.id,
          user.admin,
          user.Shekels,
          user.email,
          user.discordID,
          user.displayName,
          user.discordInfo,
          user.discordGuilds,
          user.discordToken,
          user.tokens,
          user.logonCode,
          user.logonCodeExpires,
          user.items,
          user.visits
        )
    );
  }

  getUserByToken(token) {
    this.loadUsers();
    return this.users.find((u) => u.tokens.includes(token));
  }

  isValidToken(token) {
    this.loadUsers();
    return this.users.some((u) => u.tokens.includes(token));
  }

  getUserByDiscordID(id) {
    this.loadUsers();
    return this.users.find((u) => u.discordID === id);
  }

  getUserByName(name) {
    this.loadUsers();
    let result = this.users.find(
      (u) => u.name && u.name.toLowerCase() === name.toLowerCase()
    );
    if (result) {
      return {
        success: true,
        user: result,
      };
    } else {
      return {
        success: false,
      };
    }
  }

  getUserByTrimmedName(name) {
    this.loadUsers();
    let result = this.users.find(
      (u) =>
        u.name &&
        removeMiddle(u.name.toLowerCase()) === removeMiddle(name.toLowerCase())
    );
    if (result) {
      return {
        success: true,
        user: result,
      };
    } else {
      return {
        success: false,
      };
    }
  }

  getUserByRequest(req) {
    this.loadUsers();
    const token =
      req.query.discordAuth ||
      req.body.discordAuth ||
      req.headers.token ||
      req.query.token ||
      req.body.token ||
      req.headers.token;
    if (!token)
      return {
        success: false,
      };
    return {
      success: true,
      user: this.getUserByToken(token),
    };
  }

  getPurchasesByUser(user) {
    const products = user.items || [];
    return products;
  }

  geLoginCodeByUser(user) {
    this.loadUsers();
    if (user.logonCode && user.logonCodeExpires > Date.now()) {
      return {
        success: true,
        logonCode: user.logonCode,
        expiresIn: user.logonCodeExpires - Date.now(),
      };
    } else {
      const logonCode = Math.floor(100000 + Math.random() * 900000);
      user.logonCode = logonCode;
      user.logonCodeExpires = Date.now() + 900000;
      this.userManager.writeUser(user);
      return {
        success: true,
        logonCode,
        expiresIn: user.logonCodeExpires - Date.now(),
      };
    }
  }

  writeUser(user) {
    this.loadUsers();
    if (this.users && user) {
      const userIndex = this.users.findIndex((u) => u.id === user.id);
      if (userIndex !== -1) {
        this.users[userIndex] = user;

        fs.writeFile(
          "./data/users.json",
          JSON.stringify(this.users, null, 4),
          (err) => {
            if (err) {
              console.error(`Failed to write user data: ${err}`);
            }
          }
        );
      } else {
        console.error("User not found");
        this.createUser(user);
      }
    } else {
      console.error("Undefined or empty users data OR user is undefined");
    }
  }

  createUser(user) {
    this.loadUsers();
    this.users.push(user);
    logEvent("New User Created", user);
    fs.writeFile(
      "./data/users.json",
      JSON.stringify(this.users, null, 4),
      (err) => {
        if (err) throw err;
      }
    );
  }

  async getUserGuilds(token) {
    console.log(token);
    try {
      const guildResponse = await axios.get(
        "https://discord.com/api/users/@me/guilds",
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      return guildResponse.data;
    } catch (error) {
      console.log("error in guilds");
      return null;
    }
  }
}

const userManager = new UserManager();

function updateFile() {
  userArray = [];
  users = JSON.parse(fs.readFileSync("./data/users.json"));
  for (let i = 0; i < users.length; i++) {
    userArray.push(
      new User(
        users[i].name,
        users[i].id,
        users[i].admin,
        users[i].Shekels,
        users[i].email,
        users[i].discordID,
        users[i].displayName,
        users[i].discordInfo,
        users[i].discordGuilds,
        users[i].discordToken,
        users[i].tokens,
        users[i].logonCode,
        users[i].logonCodeExpires,
        users[i].items,
        users[i].visits
      )
    );
  }

  shopArray = JSON.parse(fs.readFileSync("./data/store.json"));
  items = shopArray.items;
  for (let i = 0; i < items.length; i++) {
    items[i].id = i;
  }
}

function updateShop() {
  shopArray = JSON.parse(fs.readFileSync("./data/store.json"));
  items = shopArray.items;
  for (let i = 0; i < items.length; i++) {
    items[i].id = i;
  }
}

const app = express();
app.use(
  cors({
    credentials: true,
  }),
  cookieParser(),
  bodyParser.json()
);
const port = 80;
const httpsServer = https.createServer(credentials, app);

app.get("/login", (req, res) => {
  const url = config.loginURL;
  res.redirect(url);
});

app.get("/shop/items", (req, res) => {
  updateShop();
  let itemsToSend = [];
  for (const key in shopArray.items) {
    let item = shopArray.items[key];
    if (item.hasOwnProperty("expires_at")) {
      if (item.expires_at > Date.now()) {
        itemsToSend.push(item);
      }
    } else {
      itemsToSend.push(item);
    }
  }
  res.send({
    success: true,
    products: itemsToSend,
  });
});

app.get("/getasset/:id", (req, res) => {
  const id = req.params.id;
  if (!id)
    return res.status(401).send({
      success: false,
      message: "No asset id provided.",
    });

  const assetPath = path.join(__dirname, "data", "assets", id);

  if (fs.existsSync(assetPath)) {
    let mimeType = "application/octet-stream";
    res.sendFile(assetPath);
  } else {
    res.status(404).send({
      success: false,
      message: "Asset not found.",
    });
  }
});

app.post("/shop/purchase", (req, res) => {
  updateShop();
  if (!userManager.getUserByRequest(req).user) {
    res.status(404).send({
      success: false,
      message: "Invalid token.",
    });
  } else {
    let requestUser = userManager.getUserByRequest(req).user;
    const itemID = req.body.itemID;
    const item = shopArray.items[itemID];
    let itemIndex;

    if (!item)
      return res.status(404).send({
        success: false,
        message: "Item not found.",
      });

    if (!requestUser.items) {
      console.log("User does not have items array");
      requestUser.items = [];
      itemIndex = -1;
    } else {
      itemIndex = requestUser.items.findIndex((i) => i.id === item.id);
    }
    if (item.hasOwnProperty("expires_at")) {
      if (item.expires_at < Date.now()) {
        return res.status(403).send({
          success: false,
          message: "This item can no longer be purchased.",
        });
      }
    }
    if (
      requestUser.Shekels < item.price &&
      requestUser.id != process.env.DEBUG_ID
    ) {
      return res.status(403).send({
        success: false,
        message:
          "You need " +
          (item.price - requestUser.Shekels) +
          " more Shekels to purchase this item.",
      });
    }

    if (item.hasOwnProperty("max_quantity")) {
      let itemCount = 0;
      for (let i = 0; i < requestUser.items.length; i++) {
        if (requestUser.items[i].id === item.id) {
          if (item.hasOwnProperty("expires_after")) {
            if (requestUser.items[i].expires_after > Date.now()) {
              itemCount += 1;
            }
          } else {
            itemCount += 1;
          }
        }
      }

      if (itemCount >= item.max_quantity) {
        return res.status(403).send({
          success: false,
          message: "You can't purchase any more of this item.",
        });
      }
    }

    const newItem = {
      id: item.id,
      title: item.title,
      description: item.description,
      timestamp: Date.now(),
      price: item.price,
      ...(item.expires_after && {
        expires_after: item.expires_after + Date.now(),
      }),
    };

    requestUser.Shekels -= item.price;
    requestUser.items.push(newItem);

    userManager.writeUser(requestUser);

    let purchases = userManager.getPurchasesByUser(requestUser);

    let ownedQuantity = purchases.filter((p) => p.id === item.id).length;

    let footer = ownedQuantity;

    if (item.hasOwnProperty("max_quantity")) {
      footer += ` / ${item.max_quantity} owned.`;
    } else {
      footer += " owned.";
    }

    sendWebhook(
      "New Purchase",
      `${requestUser.name} purchased ${item.title} for ${item.price} Shekels.\n\nThey now have ${requestUser.Shekels} Shekels.\n\n${ownedQuantity} owned.`,
      7855479,
      footer,
      ["Shekels", "https://shekels.mrsharick.com/getasset/shekels_user.png"]
    );
    logPurchase(requestUser, item, item.price);

    res.send({
      success: true,
      message: "Item purchased successfully.",
    });
  }
});

app.get("/me/purchases", (req, res) => {
  let user;
  if (userManager.getUserByRequest(req).user) {
    user = userManager.getUserByRequest(req).user;
  } else {
    return res.status(401).send({
      success: false,
      message: "No token provided.",
    });
  }

  try {
    const products = userManager.getPurchasesByUser(user);
    res.status(200).send({
      success: true,
      products: products,
    });
  } catch (e) {
    console.log(e);
    res.status(404).send({
      success: false,
      message: "Unable to fetch purchases.",
    });
  }
});

app.get("/streaks/bump", async (req, res) => {
  console.log("Bumpstreak called");
  const query = req.query;
  if (query.key != process.env.BUMP_KEY) {
    return res.status(401).send({
      success: false,
      message: "Invalid key.",
    });
  }
  console.log(query.name);
  let name = query.name;

  // Remove leading & trailing spaces
  while (name.charAt(0) === " ") {
    name = name.substr(1);
  }

  while (name.charAt(name.length - 1) === " ") {
    name = name.substr(0, name.length - 1);
  }
  let userIndex = userArray.findIndex((u) => u.name === name);
  if (userIndex === -1) {
    userIndex = userArray.findIndex((u) => u.displayName === name);
    if (userIndex === -1) {
      userIndex = userArray.findIndex((u) => u.name === removeMiddle(name));
    }
  }
  if (userIndex !== -1) {
    const requestUser = userArray[userIndex];
    if (requestUser.visits) {
      if (
        Date.now() - requestUser.visits[requestUser.visits.length - 1] <
        518400000
      ) {
        return res.status(403).send({
          success: false,
          message: "Bumped too recently.",
        });
      }
      requestUser.visits.push(Date.now());
    } else {
      requestUser.visits = [Date.now()];
    }

    let streak = 0;
    const eightDaysInMillis = 8 * 24 * 60 * 60 * 1000;

    for (let i = requestUser.visits.length - 1; i > 0; i--) {
      const currentVisit = requestUser.visits[i];
      const previousVisit = requestUser.visits[i - 1];

      if (currentVisit - previousVisit <= eightDaysInMillis) {
        streak += 1;
      } else {
        break;
      }
    }

    userArray[userIndex].Shekels += (streak + 1) * 2 - 1;
    fs.writeFile(
      "./data/users.json",
      JSON.stringify(userArray, null, 4),
      (err) => {
        if (err) throw err;
      }
    );
    res.send({
      success: true,
      message: "Successfully registered visit.",
    });

    sendWebhook(
      "Streak Bump",
      `${requestUser.name} bumped their streak to ${
        streak + 1
      }.\n\nThey now have ${requestUser.Shekels} Shekels.`,
      7855479,
      "",
      ["Shekels", "https://shekels.mrsharick.com/getasset/shekels_user.png"]
    );
    logEvent("Streak Bumped", requestUser);
  } else {
    newUser = {
      name: name,
      id: uuidv4(),
      Shekels: 1,
      email: query.email,
      discordID: null,
      tokens: [],
      visits: [Date.now()],
    };
    userManager.createUser(newUser);
  }

  res.send({
    success: true,
    message: "Registered new visitor.",
  });

  sendWebhook(
    "Streak Bump / New User",
    `${newUser.name} has signed in, and an unlinked account has been created for them.\n\nThey have been given ${newUser.Shekels} Shekel.`,
    7855479,
    "",
    ["Shekels", "https://shekels.mrsharick.com/getasset/shekels_user.png"]
  );
});

app.get("/auth/discord/callback", (req, res) => {
  updateFile();
  const code = req.query.code;

  const response = axios
    .post(
      "https://discord.com/api/oauth2/token",
      {
        client_id: process.env.CLIENT_ID,
        client_secret: process.env.CLIENT_SECRET,
        grant_type: "authorization_code",
        code: code,
        redirect_uri: "https://shekels.mrsharick.com/auth/discord/callback",
      },
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/x-www-form-urlencoded",
        },
      }
    )
    .then((response) => {
      console.log(response.data);
      const token = response.data.access_token;
      const userResponse = axios
        .get("https://discord.com/api/users/@me", {
          headers: {
            Authorization: `Bearer ${response.data.access_token}`,
          },
        })
        .then((userResponse) => {
          const guildResponse = axios
            .get("https://discord.com/api/users/@me/guilds", {
              headers: {
                Authorization: `Bearer ${response.data.access_token}`,
              },
            })
            .then((guildResponse) => {
              const { id, username, discriminator, avatar, email } =
                userResponse.data;
              const { guilds } = guildResponse.data;
              const user = {
                id,
                username,
                discriminator,
                avatar,
                email,
                guilds,
              };

              const signUser = {
                id,
              };

              const access_token = sign(signUser, process.env.SIGNING_KEY_TWO, {
                expiresIn: "7d",
              });

              // Find an existing user by discord id property
              // This is for really old manually created accounts, or accounts created by the Discord bot
              const userIndex = userArray.findIndex(
                (u) => u.discordID === user.id
              );
              let foundUser = null;
              if (userIndex !== -1) {
                foundUser = userArray[userIndex];
                foundUser.discordInfo = userResponse.data;
                foundUser.discordGuilds = guildResponse.data;
                try {
                  foundUser.tokens.push(access_token);
                } catch (error) {
                  foundUser.tokens = [access_token];
                }
                userArray[userIndex] = foundUser;
              } else {
                foundUser = {
                  name: null,
                  id: uuidv4(),
                  Shekels: 0,
                  email: user.email,
                  discordID: user.id,
                  displayName: null,
                  discordInfo: userResponse.data,
                  discordGuilds: guildResponse.data,
                  discordToken: token,
                  tokens: [access_token],
                };
                userArray.push(foundUser);
              }
              fs.writeFile(
                "./data/users.json",
                JSON.stringify(userArray, null, 4),
                (err) => {
                  if (err) throw err;
                }
              );

              res.redirect(
                `https://stogacs.club/leaderboard?access_token=${access_token}`
              );
            })
            .catch((error) => {
              logError("Error in Guild response\nCode: code\nInfo:" + error);
            });
        });
    })
    .catch((error) => {
      logError("Error in User response\nCode: code\nInfo:" + error);
    });
});

app.post("/me/logout", (req, res) => {
  let userObj = userManager.getUserByRequest(req);
  if (!userObj.user) {
    res.status(404).send({
      success: false,
      message: "Invalid token.",
    });
  } else {
    let user = userObj.user;
    const all =
      req.query.hasOwnProperty("all") && req.query.all.toLowerCase() === "true";
    if (all) {
      user.tokens = [];
      logEvent("Logged out of all sessions", user);
    } else {
      user.tokens = user.tokens.filter((t) => t !== token);
      logEvent("Logged out of single session", user);
    }
    userManager.writeUser(user);
    return res.send({
      success: true,
      message: "Successfully logged out.",
    });
  }
});

app.get("/discord/user", (req, res) => {
  let user;
  if (!userManager.getUserByRequest(req).user) {
    res.status(404).send({
      success: false,
      message: "Invalid token.",
    });
  } else {
    user = userManager.getUserByRequest(req).user;
    const UserToSend = {
      name: user.name,
      id: user.id,
      admin: user.admin,
      shekels: user.Shekels,
      email: user.email,
      discordID: user.discordID,
      displayName: user.displayName,
      discordUsername: user.discordInfo.username,
      discordDiscriminator: user.discordInfo.discriminator,
      discordAvatar: user.discordInfo.avatar,
    };
    logEvent("Discord User Endpoint", user);
    res.send(UserToSend);
  }
});

app.post("/leaderboard/claim", async (req, res) => {
  const token = req.query.discordAuth;
  const { body } = req;

  let user = userManager.getUserByRequest(req);

  if (user.success === false)
    return res.status(404).json({
      message: "Invalid token.",
    });

  let currentUserGuilds;
  user = user.user;
  try {
    currentUserGuilds = await userManager.getUserGuilds(user.discordToken);
  } catch (error) {
    logError(error);
    return res.status(500).json({
      success: false,
      bad_token: true,
      logout: true,
      message:
        "Unable to verify your Discord account. Try signing out and back in via Discord or contact a club officer.",
    });
  }

  if (!currentUserGuilds) {
    logError("Unable to verify user guilds", user);
    return res.status(500).json({
      success: false,
      bad_token: true,
      logout: true,
      message:
        "Unable to verify your Discord account. Try signing out and back in via Discord or contact a club officer.",
    });
  }
  const inServer = currentUserGuilds.some(
    (guild) => guild.id === "1009284359334924349"
  );
  if (!inServer)
    return res.status(403).json({
      success: false,
      message:
        "You must be in the StogaCS Discord server to claim your account.",
    });

  if (user.name) {
    console.log(user.name);
    return res.status(403).json({
      success: false,
      message: "Your account has already been claimed.",
    });
  }

  const nameMatches = userArray.filter(
    (user) => user.name && user.name.toLowerCase() === body.name.toLowerCase()
  );
  console.log(nameMatches);

  if (badNames.some((badName) => body.name.toLowerCase().includes(badName)))
    return res.status(403).json({
      success: false,
      message:
        "Your name may need admin approval. Please, contact a club officer.",
    });

  let oldShekelCount = 0;
  let oldUserSearchObj = userManager.getUserByTrimmedName(body.name);

  if (oldUserSearchObj.success) {
    oldShekelCount += oldUserSearchObj.user.Shekels;
    oldUserSearchObj.user.name = null;
  }

  let currentYear = new Date().getFullYear();
  let currentMonth = new Date().getMonth();
  currentYear = currentMonth < 7 ? currentYear + 1 : currentYear;

  if (body.name.trim().split(" ").length !== 2) {
    return res.status(403).send({
      success: false,
      message: "Please enter your full name.",
    });
  }

  if (body.name.split(" ").some((part) => part.length < 2)) {
    return res.status(403).send({
      success: false,
      message: "Each part of your name should contain more than one character.",
    });
  }

  user.gradYear = currentYear + parseInt(body.grad_year);
  user.Shekels = oldShekelCount;
  user.name = body.name;

  if (oldUserSearchObj.success) {
    if (
      oldUserSearchObj.user.hasOwnProperty("email") &&
      oldUserSearchObj.user.email !== null
    )
      user.email = oldUserSearchObj.user.email;
    user.displayName = oldUserSearchObj.user.displayName || "";
    userManager.writeUser(oldUserSearchObj.user);
    logEvent("Account Linked\n\nOldUser: " + oldUserSearchObj.user.name, user);
  } else {
    logEvent("Account Created", user);
  }

  userManager.writeUser(user);

  res.send({
    success: true,
    message: "Account claimed successfully.",
  });
});

app.post("/leaderboard/update_prefs", (req, res) => {
  let setName = true;
  const { display_name } = req.body;
  let userSearchObj = userManager.getUserByRequest(req);
  if (userSearchObj.user) {
    let user = userSearchObj.user;

    for (let i = 0; i < user.discordGuilds.length; i++) {
      if (user.discordGuilds[i].id === "1009284359334924349") {
        inServer = true;
        break;
      }
    }

    if (!inServer) {
      setName = false;
      return res.status(403).send({
        success: false,
        message:
          "You must be in the StogaCS Discord server to claim your account.",
      });
    }

    if (user.name == null) {
      setName = false;
      return res.status(403).send({
        success: false,
        message: "You have not yet claimed your account.",
      });
    }

    badNames.forEach((name) => {
      if (display_name.toLowerCase().includes(name)) {
        setName = false;
        return res.status(403).send({
          success: false,
          message:
            "Your name may need admin approval, please contact a club officer.",
        });
      }
    });

    if (setName) {
      try {
        user.displayName = display_name;
      } catch (error) {
        setName = false;
        return res.status(400).send({
          success: false,
          message: "Please include all fields.",
        });
      }
    }

    if (setName) {
      userManager.writeUser(user);
      res.send({
        success: true,
        message: "Account updated successfully.",
      });
    }
  } else {
    res.status(404).send({
      success: false,
      message: "Invalid token.",
    });
  }
});

app.post("/users/update", (req, res) => {
  updateFile();
  const token = req.query.discordAuth;
  const body = req.body;
  if (!token)
    return res.status(401).send({
      success: false,
      message: "No token provided.",
    });

  const userIndex = userArray.findIndex((u) => u.tokens.includes(token));

  if (userIndex !== -1) {
    const requestUser = userArray[userIndex];
    if (!requestUser.admin) {
      logEvent("Unauthorized User Update", requestUser);
      return res.status(403).send({
        success: false,
        message: "You are not authorized to perform this action.",
      });
    }
    logEvent("User Update Endpoint", requestUser);
    let matchedUsers = [];
    for (var index = 0; index < body.length; index++) {
      var user = body[index];
      const userIndex = userArray.findIndex((u) => u.id === user.shekel_guid);

      if (userIndex !== -1) {
        logEvent(
          `User ${userArray[userIndex].name} (${userArray[userIndex].id}) Updated via API`
        );
        matchedUsers.push(userArray[userIndex]);
        userArray[userIndex].name = user.real_name;
        userArray[userIndex].displayName = user.display_name;
        userArray[userIndex].Shekels = user.shekels;
      } else {
        console.log("User not found, creating new user.");
        if (typeof User === "function") {
          // ensure User is a constructor
          let guid = uuidv4();
          logEvent(`User ${user.real_name} (${guid}) Created via API`);
          userArray.push(
            new User(
              user.real_name, // name
              guid, // id
              false, // admin
              user.shekels, // shekels
              null, // email
              null,
              user.display_name,
              null,
              null,
              null,
              [] //tokens
            )
          );
        }
      }
    }

    fs.writeFile(
      "./data/users.json",
      JSON.stringify(userArray, null, 4),
      (err) => {
        if (err) throw err;
      }
    );
  } else {
    res.status(404).send("Invalid token.");
  }
});

app.get("/me/login_code", (req, res) => {
  updateFile();
  let user = userManager.getUserByRequest(req).user;
  if (user) {
    let logonCode = userManager.geLoginCodeByUser(user);

    if (logonCode.success) {
      return res.send({
        success: true,
        logonCode: logonCode.logonCode,
        expiresIn: logonCode.expiresIn,
      });
    } else {
      return res.status(403).send({
        success: false,
        message: "You cannot request a logon code at this time.",
      });
    }
  } else {
    res.status(404).send("Invalid token.");
  }
});

app.post("/me/login", (req, res) => {
  timeUntilRequestOk = isRequestAllowed(req.ip);
  if (timeUntilRequestOk != 0) {
    return res.status(429).send({
      success: false,
      message:
        "You've sent too may requests to this endpoint. Please try again later.",
      retryAfter: timeUntilRequestOk,
    });
  }
  updateFile();
  const code = req.query.code;
  if (!code)
    return res.status(401).send({
      success: false,
      message: "No login code provided.",
    });
  const userIndex = userArray.findIndex(
    (u) => u.logonCode == code && u.logonCodeExpires > Date.now()
  );
  if (userIndex !== -1) {
    const user = userArray[userIndex];
    if (code == user.logonCode && user.logonCodeExpires > Date.now()) {
      user.logonCode = null;
      user.logonCodeExpires = null;

      const signUser = {
        id: user.id,
      };

      const access_token = sign(signUser, process.env.SIGNING_KEY_TWO, {
        expiresIn: "7d",
      });

      userArray[userIndex].tokens.push(access_token);

      fs.writeFile(
        "./data/users.json",
        JSON.stringify(userArray, null, 4),
        (err) => {
          if (err) throw err;
        }
      );

      logEvent("Logged In via device transfer", user);

      return res.send({
        success: true,
        message: "Successfully logged in.",
        token: access_token,
      });
    } else {
      return res.status(403).send({
        success: false,
        message: "Expired login code.",
      });
    }
  } else {
    res.status(404).send({
      success: false,
      message: "Invalid Code",
    });
  }
});

app.get("/users", (req, res) => {
  updateFile();
  let safeUsers = [];
  for (let i = 0; i < userArray.length; i++) {
    if (userArray[i].name != null) {
      let hasDiscord = false;
      let gradYear = new Date().getFullYear().toString().substr(0, 2);
      if (userArray[i].discordID != null) {
        hasDiscord = true;
      } else {
        hasDiscord = false;
      }
      try {
        gradYear += userArray[i].email.substr(0, 2);
      } catch (e) {
        gradYear = userArray[i].gradYear || null;
      }
      safeUsers.push(
        new PublicUser(
          userArray[i].name,
          userArray[i].id,
          userArray[i].Shekels,
          gradYear,
          hasDiscord,
          userArray[i].displayName
        )
      );
    }
  }

  safeUsers.sort((a, b) => {
    const aDisplayName = a.display_name || a.name || "N/A";
    const bDisplayName = b.display_name || b.name || "N/A";

    if (a.discord_linked && !b.discord_linked) {
      return -1; // a has discord_linked and b doesn't
    } else if (!a.discord_linked && b.discord_linked) {
      return 1; // b has discord_linked and a doesn't
    } else {
      // Both have or don't have discord_linked, sort alphabetically by display name
      return aDisplayName
        .toLowerCase()
        .localeCompare(bDisplayName.toLowerCase());
    }
  });

  // sort the remaining users by shekels count in descending order
  safeUsers.sort((a, b) => parseInt(b.shekels) - parseInt(a.shekels));
  // :(
  res.send(safeUsers);
});

app.get("/api/version", (req, res) => {
  res.send({
    version: sign(ver, process.env.SIGNING_KEY).split(".")[1],
  });
});

// on error 500
app.use(function (err, req, res, next) {
  logError("Error 500, " + err);
  console.error(err.stack);
  res.status(500).send({
    success: false,
    message: "An internal server error occured, please try again later.",
  });
});

// on error 404
app.use(function (req, res, next) {
  logError("Generic error 404, " + req.url);
  console.log(req.query);
  console.log(req.body);
  res.status(404).send({
    success: false,
    message: "The requested resource was not found.",
  });
});

console.log(
  "Running server with version identifier " +
    sign(ver, process.env.SIGNING_KEY).split(".")[1]
);

httpsServer.listen(443, () => {
  setupLog();
  updateFile();
  console.log(`Listening on port 443, https://shekels.mrsharick.com/`);
});

app.listen(port, () => {
  console.log(`Listening on port ${port}, http://shekels.mrsharick.com/`);
});

function removeMiddle(name) {
  let nameArray = name.split(" ");
  if (nameArray.length > 2) {
    nameArray.splice(1, 1);
    return nameArray.join(" ");
  } else {
    return name;
  }
}

function sendWebhook(title, description, color, footer, avatar) {
  let webhookData = {
    embeds: [
      {
        title: title,
        description: description,
        color: color,
        footer: {
          text: footer,
        },
      },
    ],
    username: avatar[0],
    avatar_url: avatar[1],
  };

  const sendWebhookRequest = async () => {
    let response;

    try {
      response = await axios.post(purchaseHook, webhookData);

      if (response.status === 202) {
        console.log("Webhook request queued.");
        const retryAfter = response.data.retry_after["retry-after"] || 5;
        await delay(retryAfter * 1000);
        return await sendWebhookRequest();
      } else {
        console.log("Webhook request succeeded:", response.data);
      }
    } catch (error) {
      console.error("Error sending webhook request:", error);
    }
  };

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
}
