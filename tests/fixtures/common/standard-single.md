---
name: 标准单文件样例
description: >-
  仅含标准名称和简介的合法样例，
  用于验证折叠字段、中文与未知嵌套字段。
version: "1.2.3"
metadata:
  owner: 示例作者
  nested:
    unknown: true
    flags: [a, b]
---

# 标准单文件样例

本样例用于验证完整取用与搜索投影分离。

| 字段 | 值 |
| --- | --- |
| 语言 | 中文 |
| 代码 | 保留 |

```js
const message = '你好，世界';
console.log(message);
```
