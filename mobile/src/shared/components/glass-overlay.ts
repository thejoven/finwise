/**
 * 玻璃表面上的"覆盖层"颜色 —— 不在调色板里的 rgba, 按明暗手动给.
 * (图标 / 文字色直接用 theme.color.ink / muted, 已是动态色, 会自动随明暗翻.)
 *
 * 单独成 .ts 文件 (非组件): 与 glass.tsx 的玻璃组件 (IslandGlass / TabBarGlass) 分开,
 * 让组件文件只导出组件 —— 保住 Fast Refresh (见 react-doctor only-export-components).
 */
export function glassOverlay(isDark: boolean) {
  return {
    // 胶囊边缘: 收一道更明确的边 (仍属"极淡描边"范畴) —— 两颗胶囊读起来是成对的清爽玻璃.
    border: isDark ? "rgba(255,255,255,0.16)" : "rgba(0,0,0,0.10)",
    // 选中"透镜"的边: 比胶囊边更淡, 免得抢了胶囊轮廓的镜头.
    lensBorder: isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.05)",
    // 选中"透镜"填充 (降级路径用的纯色): 不走玻璃时直接当背景色, 故偏实, 保证旧机仍看得清选中.
    activeFill: isDark ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.55)",
    // 选中"透镜"的玻璃染色 (iOS 26 玻璃路径用): 比 activeFill 淡, 让液态玻璃材质透出来 —— 是
    //   "一块玻璃"而非一块白. 太淡会被胶囊玻璃吃掉看不见, 这个量是可见与通透的折中, 可再调.
    lensGlassTint: isDark ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.30)",
  };
}
