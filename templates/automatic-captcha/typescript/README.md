# {{PROJECT_NAME}}

通过 Lexmount SDK 开启验证码自动处理，让表单任务在同一浏览器会话中继续执行。

默认示例访问 Google 的 [reCAPTCHA 表单演示页](https://recaptcha-demo.appspot.com/recaptcha-v2-checkbox.php)，填写两项内容，点击验证框触发检测，等待 Lexmount 自动处理，再提交表单并确认网站返回 `Success!`。

## 运行前准备

- 使用 Node.js 20 或更新版本，以及 Lexmount SDK 0.6.1 或更新版本。
- 项目必须具备验证码自动处理权益，且仍有可用额度。Free 套餐不包含这项能力；仅传入 `enableCaptcha: true` 不会赋予套餐权益。见[全球站额度说明](https://browser.lexmount.com/docs/pricing#automatic-captcha-allowance)。
- 使用与 API 所属站点匹配的凭据。本文演示使用全球站，浏览器网络需要能访问 Google 和 Appspot。

脚手架生成时会配置 `.env`，但不会自动运行此示例。手动配置时，复制 `.env.example` 为 `.env`，填写你自己项目的凭据：

```dotenv
LEXMOUNT_API_KEY=your_api_key_here
LEXMOUNT_PROJECT_ID=your_project_id_here
LEXMOUNT_BASE_URL=https://api.lexmount.com
# LEXMOUNT_REGION=hk-1
```

`LEXMOUNT_REGION` 可留空，让服务选择可用节点。凭据不要提交到 Git。

## 执行

```sh
npm install
npm start
```

默认运行可填写的表单示例，最多等待验证码结果 180 秒。可调整等待时间：

```sh
npm start -- --timeout-seconds 300
```

还支持 Google 的另一张演示表单，或在同一 Session 中依次执行两个示例：

```sh
npm start -- --demo google
npm start -- --demo all
```

Google `api2/demo` 的姓名、邮箱等示例字段被网站禁用，脚本只执行验证和提交。默认的 `form` 示例包含两个真正可编辑的输入框。

官方代理默认关闭，需要时显式启用：

```sh
npm start -- --official-proxy
```

代理与验证码处理独立配置。先确认当前节点的网络能够加载验证码组件，再决定是否需要代理。

## 运行结果

每次运行会在 `artifacts/<时间>/` 保存：

- `result.json`：Session ID、各任务状态、执行阶段、验证等待时间、输入内容是否保留，以及会话清理结果。
- `<demo>-before.png`：填写完成、验证开始前的页面。
- `<demo>-success.png`：网站接受提交后的页面。
- `<demo>-failed.png`：失败时的页面（浏览器仍可访问时）。

可用 `--output-dir artifacts/my-run` 指定目录。再次使用同一目录会覆盖同名文件。

脚本只在网站返回成功信息后将任务标记为 `passed`；拿到验证码响应或复选框打勾并不代表表单提交成功。验证码响应和 API Key 不会写入报告。脚本不识别验证码图片，不注入验证码响应，也不要求人工解题。

正常完成、步骤失败或按下 Ctrl+C 后，脚本会尝试删除已经取得 ID 的云会话。清理失败会记录到报告并返回非零退出码，需要在控制台按 Session ID 停止会话。若创建请求在返回会话前失败，也应在控制台核对是否留下会话。

超时只表示等待期间没有获得验证结果，不能据此判断服务正在处理或只是速度慢。根据 `stage` 区分页面加载、组件加载、验证码等待和网站接受提交等问题，再检查套餐权益、剩余额度与服务状态。

## 当前验证状态

此示例尚未完成有验证码权益项目的云端成功验证。此前的全球站测试确认了两个演示页面可访问、表单可填写、验证框可触发；测试项目为 Free，未获得自动验证成功结果。获得可用权益后，应以默认表单返回 `Success!` 为验收标准。

本地类型检查：

```sh
npm run typecheck
```
