<template>
  <div class="flex min-h-screen">
    <nav class="w-56 bg-slate-900 text-gray-300 shrink-0">
      <div class="px-5 py-5 border-b border-slate-700">
        <h2 class="m-0 text-white text-lg font-bold">ArcFlow</h2>
      </div>
      <ul class="list-none p-0 m-0 mt-2">
        <li>
          <router-link
            to="/dashboard"
            active-class="!bg-slate-800 !text-white"
            class="block px-5 py-2.5 text-gray-400 no-underline hover:bg-slate-800 hover:text-white transition-colors"
          >
            系统概览
          </router-link>
        </li>
        <li>
          <router-link
            to="/workflows"
            active-class="!bg-slate-800 !text-white"
            class="block px-5 py-2.5 text-gray-400 no-underline hover:bg-slate-800 hover:text-white transition-colors"
          >
            工作流执行
          </router-link>
        </li>
        <li>
          <router-link
            to="/trigger"
            active-class="!bg-slate-800 !text-white"
            class="block px-5 py-2.5 text-gray-400 no-underline hover:bg-slate-800 hover:text-white transition-colors"
          >
            触发工作流
          </router-link>
        </li>
      </ul>
    </nav>
    <main class="flex-1 p-6 bg-gray-50">
      <router-view />
    </main>
  </div>
</template>
