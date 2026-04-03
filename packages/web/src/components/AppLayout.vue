<template>
  <div class="app-layout">
    <nav class="sidebar">
      <div class="logo">
        <h2>ArcFlow</h2>
      </div>
      <ul class="nav-list">
        <li>
          <router-link to="/dashboard" active-class="active">系统概览</router-link>
        </li>
        <li>
          <router-link to="/workflows" active-class="active">工作流执行</router-link>
        </li>
        <li>
          <router-link to="/trigger" active-class="active">触发工作流</router-link>
        </li>
      </ul>
    </nav>
    <main class="content">
      <router-view />
    </main>
  </div>
</template>

<style scoped>
.app-layout {
  display: flex;
  min-height: 100vh;
}

.sidebar {
  width: 220px;
  background: #1a1a2e;
  color: #e0e0e0;
  padding: 20px 0;
  flex-shrink: 0;
}

.logo {
  padding: 0 20px 20px;
  border-bottom: 1px solid #333;
}

.logo h2 {
  margin: 0;
  color: #fff;
}

.nav-list {
  list-style: none;
  padding: 10px 0;
  margin: 0;
}

.nav-list li a {
  display: block;
  padding: 10px 20px;
  color: #b0b0b0;
  text-decoration: none;
  transition: background 0.2s;
}

.nav-list li a:hover,
.nav-list li a.active {
  background: #16213e;
  color: #fff;
}

.content {
  flex: 1;
  padding: 24px;
  background: #f5f5f5;
}
</style>
