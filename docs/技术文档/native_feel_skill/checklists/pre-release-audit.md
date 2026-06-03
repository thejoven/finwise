# 发布前 60 项审计清单 · RN

> 每个 Phase 上线 TestFlight 或 beta 前完整跑一遍。
> 真机走完所有页面, 一项一项核对。

---

## 一、视觉 (15 项)

### A · 字体
- [ ] 1. Display / Serif / Sans / Mono 在所有场景显示正确
- [ ] 2. 字体加载完成才显示 UI(没 FOUT 闪烁)
- [ ] 3. 数字等宽 (tabular-nums) 在持仓金额、时间戳处对齐
- [ ] 4. 中英混排不抖动, 中文 fallback 工作
- [ ] 5. iOS Dynamic Type 开启大字号后 UI 不破坏

### B · 颜色
- [ ] 6. 没有 `#XXXXXX` 硬编码(grep 检查)
- [ ] 7. 红色只用在: 重要标记、退出条件警告、删除按钮; 没有泛用
- [ ] 8. theme.color tokens 覆盖所有使用场景

### C · 圆角与间距
- [ ] 9. 按钮圆角 radius.md(10pt), 卡片 radius.lg(14pt), 签字按钮 radius.none
- [ ] 10. 间距严格走 spacing token
- [ ] 11. 分割线用 hairlineWidth
- [ ] 12. 列表项左右 padding 16pt

### D · 报刊感
- [ ] 13. DoubleRule 在 Masthead 和 Section 分隔处一致
- [ ] 14. 罗马数字(I. II. III.)在退出条件等列表正确
- [ ] 15. EditorialBlock 在 E4 主笔按、复盘等场景一致

---

## 二、平台适配 (12 项)

### E · iOS
- [ ] 16. SafeAreaView 包所有屏幕
- [ ] 17. StatusBar 跟随主题
- [ ] 18. Modal 是从下滑入(slide_from_bottom)
- [ ] 19. 左滑返回手势在所有非顶层页面工作
- [ ] 20. FlatList Pull-to-refresh 有 RefreshControl
- [ ] 21. 键盘弹起不遮挡输入框(KeyboardAvoidingView)
- [ ] 22. Status bar 颜色与背景适配(深背景 light)

### F · Android(Phase 已含 Android)
- [ ] 23. 物理 back 键工作
- [ ] 24. android_ripple 显式设置(关闭或自定义颜色)
- [ ] 25. Edge-to-edge 状态栏适配
- [ ] 26. 没有 Material Ripple 突兀出现在自绘按钮

### G · 跨平台
- [ ] 27. 同样的页面在两边视觉一致(只行为不同)

---

## 三、组件 (10 项)

- [ ] 28. 没有 `<Button>` from 'react-native'(grep)
- [ ] 29. 没有 `Alert.alert`(grep)
- [ ] 30. 没有 `ActivityIndicator`(grep)
- [ ] 31. 没有 `TouchableOpacity` 默认使用(只在 TapEffect 内部允许)
- [ ] 32. 没有 `Vibration` import(grep)
- [ ] 33. 长列表都用 FlatList
- [ ] 34. 字体组件用 Display / Serif / Sans / Mono, 不裸 Text
- [ ] 35. ActionSheet 自绘, 没用第三方
- [ ] 36. 图标用 lucide-react-native
- [ ] 37. expo-image 用于网络图片(如有)

---

## 四、交互与反馈 (12 项)

### H · 反馈克制
- [ ] 38. 录入成功页面不弹 Toast / SnackBar
- [ ] 39. 签字成功不弹弹窗, 直接进入持仓页
- [ ] 40. 错误反馈 inline, Dialog 只在不可逆动作前
- [ ] 41. 没有任何 spinner 出现
- [ ] 42. 长操作用打字机效果或不显示进度

### I · 触感(真机测)
- [ ] 43. 切换 Tab 用 selectionAsync
- [ ] 44. 签字按钮按下用 impactAsync(Medium)(onPressIn)
- [ ] 45. 退出条件触发用 impactAsync(Medium)(一次)
- [ ] 46. 录入成功**不震动**
- [ ] 47. 错误**不震动**
- [ ] 48. 没有 notificationAsync 调用
- [ ] 49. 触感事件之间至少 500ms 间隔

---

## 五、财富密码 哲学 (8 项)

- [ ] 50. 没有 FAB
- [ ] 51. 没有 Drawer
- [ ] 52. 没有红点角标 / app icon badge
- [ ] 53. 没有 push notification 权限请求
- [ ] 54. 没有 onboarding 流程
- [ ] 55. 没有 Streak / 连续打卡天数
- [ ] 56. 没有"邀请朋友"、"分享"按钮
- [ ] 57. 没有"新功能上线"弹窗

---

## 六、依赖检查 (3 项)

```bash
# 这些应该都不在 package.json
grep -E "(react-native-toast|react-native-flash-message|react-native-paper|react-native-elements|react-native-onboarding|react-native-tooltip|react-native-walkthrough-tooltip|react-native-swipe-list|lottie-react-native|react-native-confetti|react-native-vector-icons)" package.json
# 应该无输出
```

- [ ] 58. 跑上面命令无输出
- [ ] 59. expo-notifications **不**在 dependencies
- [ ] 60. 跑 `tools/check-banned-deps.sh` 通过

---

## 上线决策

| 状态 | 行动 |
|---|---|
| 60 项全过 | 发 TestFlight, 开始"自己用一周" |
| 1-3 项不过, 都不是一票否决 | 可发, backlog 修复 |
| 4+ 项不过, 或一票否决 | 不发, 修复后重审 |

一票否决:
- 第 19 项(左滑返回不工作)
- 第 28-32 项任一(用了禁止组件)
- 第 38 项(成功弹 Toast)
- 第 46 项(录入震动)
- 第 50, 52, 53 项任一(FAB / 红点 / push)
- 第 58 项(用了黑名单库)

---

## 一句话总结

> 这 60 项不是完美主义, 是产品哲学的物质形态。
>
> 上线前认真过完, 你就有底气说:
> **"这是 财富密码, 不是又一个 RN APP。"**
