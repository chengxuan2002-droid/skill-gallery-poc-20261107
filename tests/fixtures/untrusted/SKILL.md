---
name: 不可信内容样例
description: 恶意展示与附件样例
version: "1.0.0"
---

# 安全标题

<script>globalThis.UNTRUSTED_SCRIPT_EXECUTED = true;</script>

<iframe src="https://example.com/embed"></iframe>

<img src="x" onerror="globalThis.UNTRUSTED_IMG_EXECUTED = true">

<form action="https://example.com/steal"><input name="secret"></form>

<object data="https://example.com/object"></object>

<div style="background:url(javascript:alert(1))">样式</div>

[危险](javascript:alert(1))

[data](data:text/html,<script>alert(1)</script>)

[file](file:///etc/passwd)

[外链](https://example.com/path)

<h1 id="forged" name="bad">伪造标题</h1>

![伪造图片](assets/fake.png)

![安全图片](assets/real.png)

![活动图片](assets/evil.svg)

`[伪链接](missing.md)`
