const Eris = require("eris-additions")(require("eris"));
const fs = require("fs");
const Sequelize = require("sequelize");

const PermissionError = require("./errors/permissionError");

const Group = require("./group");
const Logger = require("./logger");

const initDB = require("./utils/initDB");

function validatePermission(member, permissions) {
  if (permissions instanceof Array) {
    for (const permission of permissions) {
      const hasPermission = member.permission.has(permission);
      if (!hasPermission)
        throw new PermissionError("missing permission.", permission);
    }
  } else {
    const hasPermission = member.permission.has(permissions);
    if (!hasPermission)
      throw new PermissionError("missing permission.", permissions);
  }
}

class CmdClient extends Eris.Client {
  constructor(token, options = {}) {
    super(token, options);
    this.prefix = options.prefix || "!";
    this.owners = options.owners || [];

    this.commands = new Eris.Collection();
    this.groups = new Eris.Collection();

    this.debugMode = options.debugMode || false;

    this.logger = new Logger(options.debugMode ? Logger.TRACE : Logger.INFO, "codename_yey");
    this.logger.info("logger initialized.");

    this.languages = this._loadLanguages();

    this.supportChannelID = options.supportChannelID;

    this.sequelizeLogger = new Logger(this.debugMode ? Logger.TRACE : Logger.INFO, "sequelize");
    global.sequelize = new Sequelize(options.db.database, options.db.username, options.db.password, {
      host: options.db.localhost,
      dialect: options.db.dialect,
      storage: options.db.storage,
      logging: (...msg) => this.sequelizeLogger.debug(msg),
    });
    global.db = initDB(sequelize, Sequelize.DataTypes);

    if (options.debugMode) {
      this._erisLogger = new Logger(Logger.TRACE, "eris");
      this.on("debug", msg => this._erisLogger.debug(msg));
    }

    this.on("messageCreate", async msg => {
      if (!msg.content.toLowerCase().startsWith(this.prefix) || msg.author.bot) return;
      const args = this._parseArgs(msg.content);
      const commandName = args.shift().toLowerCase().slice(this.prefix.length);
      if (!this.commands.has(commandName)) return;

      const command = this.commands.get(commandName);
      const lang = this.languages.get((await db.languages.findOrCreate({ where: { user: msg.author.id } }))[0].lang);

      if (command.guildOnly && !msg.channel.guild)
        return msg.channel.createMessage(lang.cantUseCommandInDM);

      if (command.ownerOnly && this.owners.indexOf(msg.author.id) === -1)
        return;

      try {
        if (command.requiredPermissions) validatePermission(msg.member, command.requiredPermissions);
        await command.run(this, msg, args, this.prefix, lang);
        this.logger.info(`${msg.author.username}#${msg.author.discriminator} used ${commandName} command in ${msg.channel.guild ? msg.channel.guild.name : "bot DM"}`);
      } catch (err) {
        this.emit("commandError", commandName, msg, err, true, lang);
      } 
    });
    
    this.logger.info("client initialized.");
  }

  _parseArgs(str) {
    let args = [];

    while (str.length) {
      let arg;
      if (str.startsWith('"') && str.indexOf('"', 1) > 0) {
        arg = str.slice(1, str.indexOf('"', 1));
        str = str.slice(str.indexOf('"', 1) + 1);
      } else {
        arg = str.split(/\s+/g)[0].trim();
        str = str.slice(arg.length);
      }
      args.push(arg.trim())
      str = str.trim()
    }

    return args;
  }

  _loadLanguages() {
    let languages = new Eris.Collection();

    let englishLang = require("./languages/en");
    languages.set("en", englishLang);

    let files = fs.readdirSync("./src/languages").filter(f => f.endsWith(".js") || f !== "en.js");
    for (let file of files) {
      let langName = file.replace(".js", "");
      let lang = require(`./languages/${file}`);

      for (let key in englishLang) {
        if (lang[key]) continue;
        lang[key] = englishLang[key];
      }
    
      languages.set(langName, lang);
      this.logger.debug(`loaded ${langName} language.`);
    }
    
    this.logger.info("successfully loaded all language files.");
    return languages;
  }

  loadCommand(path) {
    const command = require(path);
    if (!this.groups.has(command.group)) {
      if (command.group)
        this.groups.set(command.group, new Group(this, command.group));
      else this.groups.set("Uncategorized", new Group(this, "Uncategorized"));
    }

    this.commands.set(command.name, command);
    this.logger.debug(`successfully loaded ${command.name} command.`);
  }

  loadGroups(groups) {
    this.logger.info("loading the commands...")
    for (const dir of groups) {
      const commands = fs.readdirSync(`./src/commands/${dir}`).filter(f => f.endsWith(".js"));
      for (let command of commands)
        this.loadCommand(`./commands/${dir}/${command}`);
    }
    this.logger.info(`successfully loaded all commands.`);
  }

  reloadCommand(commandName) {
    let command = this.commands.get(commandName);
    if (!command)
      throw new Error("command does not exist.");

    let enLang = this.languages.get("en")

    let pathToCommand = require.resolve(`./commands/${enLang[command.group]}/${commandName}`);
    delete require.cache[pathToCommand];

    this.commands.delete(commandName);
    this.loadCommand(pathToCommand);
  }

  reloadLanguages() {
    for (let lang of this.languages.keys()) {
      let path = require.resolve(`./languages/${lang}`);
      delete require.cache[path];
    }

    this.languages.clear();

    this.languages = this._loadLanguages();
  }

  async connect() {
    this.logger.info("trying to login now...");
    return super.connect();
  }
}

CmdClient.PermissionError = PermissionError;
CmdClient.Group = Group;
CmdClient.Logger = Logger;

module.exports = CmdClient;
