# {{PROJECT_NAME}}

通过 Lexmount SDK 开启验证码自动处理，让表单任务在同一浏览器会话中继续执行。

默认示例访问 Google 的 [reCAPTCHA v2 演示页](https://www.recaptcha.net/recaptcha/api2/demo)，点击验证框触发检测，等待 Lexmount 自动处理，再提交表单并确认网站返回 `Verification Success... Hooray!`。

这个入口已在国内南京节点、不开启官方代理的情况下实测通过。它是 Google 提供的 `recaptcha.net` 入口，姓名、邮箱等示例字段由网站禁用；默认任务演示的是验证码处理与后续提交。

## 运行前准备

- 使用 Node.js 20 或更新版本，以及 Lexmount SDK 0.6.1 或更新版本。
- 项目必须具备验证码自动处理权益，且仍有可用额度。Free 套餐不包含这项能力；仅传入 `enableCaptcha: true` 不会赋予套餐权益。见[国内站额度说明](https://browser.lexmount.cn/docs/pricing)或[全球站额度说明](https://browser.lexmount.com/docs/pricing#automatic-captcha-allowance)。
- 使用与 API 所属站点匹配的凭据。脚手架的 `--cloud cn` 或 `--cloud global` 会配置对应的 API 地址及凭据。

脚手架会配置 `.env`、安装依赖并自动运行示例。手动配置时，复制 `.env.example` 为 `.env`，填写你自己项目的凭据：

```dotenv
LEXMOUNT_API_KEY=your_api_key_here
LEXMOUNT_PROJECT_ID=your_project_id_here
LEXMOUNT_BASE_URL=https://api.lexmount.cn
# LEXMOUNT_REGION=nanjing-1
```

全球站使用 `LEXMOUNT_BASE_URL=https://api.lexmount.com` 和全球站凭据。`LEXMOUNT_REGION` 可留空，让服务选择可用节点；要复现本次国内验收，可设为 `nanjing-1`。凭据不要提交到 Git。

## 执行

在准备存放项目的目录执行一条命令，即可完成项目生成、凭据配置、依赖安装和云端任务：

```sh
npx create-lexmount-app@latest --template auto-captcha --language typescript --cloud cn
```

使用 `--no-install` 或 `--no-auth` 跳过安装或授权时，脚手架不会自动执行云端任务，并会打印后续步骤。手动补齐配置后，在项目目录执行：

```sh
npm install
npm start
```

默认运行 `recaptcha-net` 示例，最多等待验证码结果 180 秒。需要再次运行时，在生成的项目目录执行 `npm start`。也可调整等待时间：

```sh
npm start -- --timeout-seconds 300
```

还保留两个可选演示入口，它们需要浏览器能访问 `google.com` 和 Appspot：

```sh
npm start -- --demo form
npm start -- --demo google
npm start -- --demo all
```

`form` 使用 Appspot 表单，填写两个输入框，并在验证后检查内容仍保留、提交返回 `Success!`。`google` 使用 `google.com` 上的官方演示页。`all` 会在同一 Session 中依次执行三个入口；国内网络测试建议使用默认入口。

官方代理默认关闭，需要时显式启用：

```sh
npm start -- --official-proxy
```

代理与验证码处理独立配置。先确认当前节点的网络能够加载验证码组件，再决定是否需要代理。

## 运行结果

每次运行会在 `artifacts/<时间>/` 保存：

- `result.json`：Session ID、各任务状态、执行阶段、验证等待时间、输入内容是否保留，以及会话清理结果。
- `<demo>-before.png`：验证开始前的页面。
- `<demo>-success.png`：网站接受提交后的页面。
- `<demo>-failed.png`：失败时的页面（浏览器仍可访问时）。

任务结束后，云浏览器会话和当前页面会保留，终端会显示 Session ID 与国内站或全球站控制台入口。你可以在控制台查看页面，完成后自行停止会话。报告中的 `cleanup: "session-kept"` 表示脚本没有主动停止会话。

可用 `--output-dir artifacts/my-run` 指定目录。再次使用同一目录会覆盖同名文件。

脚本只在网站返回成功信息后将任务标记为 `passed`；拿到验证码响应或复选框打勾并不代表表单提交成功。验证码响应和 API Key 不会写入报告。脚本不识别验证码图片，不注入验证码响应，也不要求人工解题。

自动回填后，验证码弹窗可能仍遮挡提交按钮。示例使用原生表单 `requestSubmit` 提交，保留浏览器表单校验，并让网站服务端验证收到的验证码响应。

正常完成、步骤失败或按下 Ctrl+C 后，脚本只断开本地自动化连接，不关闭远程页面，也不调用会话停止接口。终端退出后仍可在控制台查看和停止会话；保留期间会继续占用会话额度，仍受服务端时长和套餐限制。若创建请求在返回会话前失败，应在控制台核对是否已创建会话。

超时只表示等待期间没有获得验证结果，不能据此判断服务正在处理或只是速度慢。根据 `stage` 区分页面加载、组件加载、验证码等待和网站接受提交等问题，再检查套餐权益、剩余额度与服务状态。

## 当前验证状态

2026-10-14，默认 `recaptcha-net` 流程在国内 Pro 项目、官方代理关闭的条件下完成真实验证，站点返回 `Verification Success... Hooray!`。脚本退出后，重新连接确认会话仍为 `active`，成功页面仍保留；另一次 Ctrl+C 测试也确认会话和页面保留。实际耗时受验证码服务及网络影响。

本次发布的云端验收以默认入口为准；`form` 和 `google` 两个可选入口尚未完成同等条件的成功验收。本模板不用于测试极验等未接入的验证码类型。

本地类型检查：

```sh
npm run typecheck
```
