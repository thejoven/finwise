# 新页面提交前 · 30 项自查清单 · RN

> 写完一个新的 RN 页面, 提交 PR 前过一遍。
> 不是发布前完整审计(那个 60 项见 pre-release-audit.md), 是日常自查。

---

## 用法

每完成一个新页面, 复制这份到 PR 描述, 逐项打勾。不通过的项要解释。

---

## A · 平台适配 (6 项)

- [ ] 1. 用了 `Platform.OS === 'ios'` 判断平台, 没用第三方 hook
- [ ] 2. SafeAreaView 用的是 `react-native-safe-area-context`, 不是 RN 自带的
- [ ] 3. StatusBar 用了 `expo-status-bar`
- [ ] 4. 所有按钮是 `Pressable` 或自绘 `TapEffect`, 没有 `Button` / `TouchableOpacity`
- [ ] 5. iOS 上左滑返回手势工作
- [ ] 6. Modal 用了 Expo Router 的 `presentation: 'modal'` 或自绘 ActionSheet

## B · 组件选择 (5 项)

- [ ] 7. 没有用 `Alert.alert`, 用了自绘 ActionSheet
- [ ] 8. 没有用 `ActivityIndicator`
- [ ] 9. 长列表用 `FlatList`(不是 ScrollView + map)
- [ ] 10. 图标用 `lucide-react-native`, 不是 `react-native-vector-icons`
- [ ] 11. 没有用 `react-native-vector-icons`、`react-native-elements`、`react-native-paper`

## C · 样式 (6 项)

- [ ] 12. 颜色全部走 `theme.color.*`, 没硬编码 `#XXXXXX`
- [ ] 13. 间距全部走 `theme.spacing.*`, 没奇怪数字
- [ ] 14. 字号全部走 `theme.fontSize.*`
- [ ] 15. 圆角全部走 `theme.radius.*`
- [ ] 16. 分割线用 `StyleSheet.hairlineWidth`, 不是 `borderWidth: 1`
- [ ] 17. 用了 `StyleSheet.create`, 没有大块 inline style

## D · 字体 (3 项)

- [ ] 18. 用了 `<Display>` / `<Serif>` / `<Sans>` / `<Mono>` 组件, 不是裸 `Text`
- [ ] 19. 数字用了 `<Mono>` 或 `fontVariant: ['tabular-nums']`
- [ ] 20. 字体加载完成才渲染(SplashScreen 在 _layout.tsx 处理)

## E · 反馈与触感 (5 项)

- [ ] 21. 录入 / 完成动作**没有**弹 Toast(grep 检查无 toast 库)
- [ ] 22. 错误信息是 inline 显示, 不是 Alert
- [ ] 23. 没有显示 Loading Spinner
- [ ] 24. 触感反馈遵循 `06-haptic-grammar.md` 的语法
- [ ] 25. 没有用 `Vibration` API

## F · 财富密码 哲学 (3 项)

- [ ] 26. 没有 FAB / Drawer / 红点角标 / 滑动删除
- [ ] 27. 文案用 "归档"、"签字" 等产品词, 没用"保存"、"提交"
- [ ] 28. 空状态文案接纳, 不催促

## G · 代码质量 (2 项)

- [ ] 29. FlatList 有 `keyExtractor`, `renderItem` 用 `useCallback`
- [ ] 30. `useEffect` 有 cleanup(订阅、timer)

---

## 一票否决项

下面任何一项不通过, **必须修复后再提交 PR**:

- ❗ 第 4 项(用了默认 Button)
- ❗ 第 7 项(用了 Alert.alert)
- ❗ 第 21 项(弹了 Toast)
- ❗ 第 26 项(出现 FAB / 红点)
- ❗ 第 27 项(文案用错词)

---

## 不通过怎么办

不要静默修改。在 PR 里写出:

```
## Native Feel 自查
- ✓ 1-30 通过
- ⚠️ 第 22 项: 退出条件触发用了 ActionSheet 模态
   理由: 这是不可逆动作的最后确认, 必须强中断
```

让其他 reviewer 知道偏离规则是有意识的。
