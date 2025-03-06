

require("dotenv").config();
const log4js = require("log4js");
const recording = require("log4js/lib/appenders/recording");
const superagent = require("superagent");
const CloudClient = require("./CloudClient");
const fs = require('fs');
const path = require('path');
const env = require("./env");

log4js.configure({
  appenders: {
    vcr: { type: "recording" },
    out: {
      type: "console",
      layout: {
        type: "pattern",
        pattern: "\u001b[32m%d{yyyy-MM-dd hh:mm:ss}\u001b[0m - %m"
      }
    }
  },
  categories: { default: { appenders: ["vcr", "out"], level: "info" } }
});

const logger = log4js.getLogger();

const mask = (s, start, end) => s.split("").fill("*", start, end).join("");

const doTask = async (cloudClient) => {

  let timeout = 40000; // 40秒
  let abortController = new AbortController(); // 创建 AbortController

  let result = [];
  let signPromises1 = [];
  let getSpace = [`${firstSpace}签到个人云获得(M)`];

  if (env.private_only_first == false || i == 1) {
    for (let m = 0; m < private_threadx; m++) {
      signPromises1.push((async () => {
        try {
          const res1 = await cloudClient.userSign();
          if (!res1.isSign) {
            getSpace.push(` ${res1.netdiskBonus}`);
          }
        } catch (e) {
        }
      })());
    }
  }
  //超时中断
  try {
    await Promise.race([Promise.all(signPromises1), new Promise((_, reject) => {
      setTimeout(() => {
        abortController.abort(); // 取消任务
        reject(new Error("Task timed out after 40 seconds"));
      }, timeout);
    })]);
  } catch (error) {
    console.error(error.message); // 输出超时信息
  }
  if (getSpace.length == 1) getSpace.push(" 0");
  result.push(getSpace.join(""));


  abortController = new AbortController(); // 创建 AbortController
  signPromises1 = []
  getSpace = [`${firstSpace}获得(M)`];
  const { familyInfoResp } = await cloudClient.getFamilyList();
  if (familyInfoResp) {
    const family = familyInfoResp.find((f) => f.familyId == FAMILY_ID) || familyInfoResp[0];
    result.push(`${firstSpace}开始签到家庭云 ID: ${family.familyId}`);
    for (let i = 0; i < family_threadx; i++) {
      signPromises1.push((async () => {
        try {
          const res = await cloudClient.familyUserSign(family.familyId);
          if (!res.signStatus) {
            getSpace.push(` ${res.bonusSpace}`);
          }
        } catch (e) {
          getSpace.push(` 0`);
        }
      })());
    }
    //超时中断
    try {
      await Promise.race([Promise.all(signPromises1), new Promise((_, reject) => {
        setTimeout(() => {
          abortController.abort(); // 取消任务
          reject(new Error("Task timed out after 40 seconds"));
        }, timeout);
      })]);
    } catch (error) {
      console.error(error.message); // 输出超时信息
    }

    if (getSpace.length == 1) getSpace.push(" 0");
    result.push(getSpace.join(""));
  }
  return result;
};

const pushTelegramBot = (title, desp) => {
  if (!(telegramBotToken && telegramBotId)) {
    return;
  }
  const data = {
    chat_id: telegramBotId,
    text: `${title}\n\n${desp}`,
  };
  superagent
    .post(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`)
    .send(data)
    .timeout(3000)
    .end((err, res) => {
      if (err) {
        logger.error(`TelegramBot推送失败:${err}`);
        return;
      }
      const json = JSON.parse(res.text);
      if (!json.ok) {
        logger.error(`TelegramBot推送失败:${JSON.stringify(json)}`);
      } else {
        logger.info("TelegramBot推送成功");
      }
    });
};

const pushWxPusher = (title, desp) => {
  if (!(WX_PUSHER_APP_TOKEN && WX_PUSHER_UID)) {
    return;
  }
  const data = {
    appToken: WX_PUSHER_APP_TOKEN,
    contentType: 1,
    summary: title,
    content: desp,
    uids: [WX_PUSHER_UID],
  };
  superagent
    .post("https://wxpusher.zjiecode.com/api/send/message")
    .send(data)
    .timeout(3000)
    .end((err, res) => {
      if (err) {
        logger.error(`wxPusher推送失败:${JSON.stringify(err)}`);
        return;
      }
      const json = JSON.parse(res.text);
      if (json.data[0].code !== 1000) {
        logger.error(`wxPusher推送失败:${JSON.stringify(json)}`);
      } else {
        logger.info("wxPusher推送成功");
      }
    });
};

const push = (title, desp) => {
  pushWxPusher(title, desp)
  pushTelegramBot(title, desp)
}

let firstSpace = "  ";

let accounts_group = env.tyys.trim().split("--")
let FAMILY_ID
let WX_PUSHER_UID = env.WX_PUSHER_UID
let WX_PUSHER_APP_TOKEN = env.WX_PUSHER_APP_TOKEN

let telegramBotToken = env.TELEGRAM_BOT_TOKEN
let telegramBotId = env.TELEGRAM_CHAT_ID

let private_threadx = env.private_threadx; //进程数
let family_threadx = env.family_threadx; //进程数
let filePath = path.join(__dirname, 'tyys_cookies.json'); // cookie保存文件路径
let i

//用来存储cookies
let CookiesMap = new Map();
let cloudClient = new CloudClient()
let userNameInfo;

const main = async () => {
  let accounts

  if (fs.existsSync(filePath)) {
    const readSerializedMap = fs.readFileSync(filePath, 'utf-8'); // 读取文件内容
    // 反序列化字符串为 Map 对象
    try {
      CookiesMap = new Map(JSON.parse(readSerializedMap));
    } catch (e) {
      console.error(e)
    }
  }

  for (let p = 0; p < accounts_group.length; p++) {
    accounts = accounts_group[p].trim().split(/[\n ]+/);

    let familyCapacitySize, familyCapacitySize2, firstUserName;
    FAMILY_ID = accounts[0]

    for (i = 1; i < accounts.length; i += 2) {
      const [userName, password] = accounts.slice(i, i + 2);
      if (!userName || !password) continue;

      userNameInfo = mask(userName, 3, 7);

      try {

        logger.log(`${(i - 1) / 2 + 1}.账户 ${userNameInfo} 开始执行`);

        let gg = `${firstSpace}`

        if (CookiesMap.has(userName)) {
          cloudClient.setCookieMap(CookiesMap.get(userName))
          gg += `本地有储存此账号cookie`
        } else {
          gg += `本地没有储存此账号cookie`
        }

        let cookie_is_believe = await cloudClient.cookie_is_believe()
        if (!cookie_is_believe) {
          cloudClient._setLogin(userName, password)
          await cloudClient.login();
          CookiesMap.set(userName, cloudClient.getCookieMap())
          gg += ` 失效重新登录`
        } else {
          gg += ` 并且有效`
        }
        logger.log(gg)

        let { cloudCapacityInfo: cloudCapacityInfo0, familyCapacityInfo: familyCapacityInfo0 } = await cloudClient.getUserSizeInfo();

        const result = await doTask(cloudClient);
        result.forEach((r) => logger.log(r));

        let { cloudCapacityInfo: cloudCapacityInfo2, familyCapacityInfo: familyCapacityInfo2 } = await cloudClient.getUserSizeInfo();

        if (i == 1) {
          firstUserName = userName
          familyCapacitySize = familyCapacityInfo0.totalSize
          familyCapacitySize2 = familyCapacitySize
        }

        //重新获取主账号的空间信息
        cloudClient.setCookieMap(CookiesMap.get(firstUserName))
        const { familyCapacityInfo } = await cloudClient.getUserSizeInfo();

        logger.log(
          `${firstSpace}实际：个人容量+ ${(cloudCapacityInfo2.totalSize - cloudCapacityInfo0.totalSize) / 1024 / 1024}M, 家庭容量+ ${(familyCapacityInfo.totalSize - familyCapacitySize2) / 1024 / 1024}M`
        );
        logger.log(
          `${firstSpace}个人总容量：${(cloudCapacityInfo2.totalSize / 1024 / 1024 / 1024).toFixed(2)}G, 家庭总容量：${(familyCapacityInfo2.totalSize / 1024 / 1024 / 1024).toFixed(2)}G`
        );
        familyCapacitySize2 = familyCapacityInfo.totalSize

      } catch (e) {
        logger.error(e);
        if (e.code === "ETIMEDOUT") throw e;
      } finally {
        //打扫cookie
        cloudClient.cleanCookie()
        logger.log("");
      }

    }
    userNameInfo = mask(firstUserName, 3, 7);
    const capacityChange = familyCapacitySize2 - familyCapacitySize;
    logger.log(`主账号${userNameInfo} 家庭容量+ ${capacityChange / 1024 / 1024}M`);

    cloudClient.setCookieMap(CookiesMap.get(firstUserName))
    let { cloudCapacityInfo: cloudCapacityInfo2, familyCapacityInfo: familyCapacityInfo2 } = await cloudClient.getUserSizeInfo();
    logger.log(
      `主账号个人总容量：${(cloudCapacityInfo2.totalSize / 1024 / 1024 / 1024).toFixed(2)}G, 家庭总容量：${(familyCapacityInfo2.totalSize / 1024 / 1024 / 1024).toFixed(2)}G`
    );
    logger.log("");

  }

  const serializedMap = JSON.stringify(Array.from(CookiesMap), null, 2);
  fs.writeFileSync(filePath, serializedMap, 'utf-8'); // 写入文件

};

(async () => {
  try {
    if (env.tyys == "") {
      logger.error("没有设置tyys环境变量")
      return
    }
    await main();
  } finally {
    logger.log("\n\n");
    const events = recording.replay();
    const content = events.map((e) => `${e.data.join("")}`).join("  \n");
    push("天翼云盘自动签到任务", content);
    recording.erase();
  }
})();
