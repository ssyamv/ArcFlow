import { createRouter, createWebHistory } from "vue-router";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/",
      redirect: "/workflows",
    },
    {
      path: "/workflows",
      name: "workflows",
      component: () => import("../pages/WorkflowList.vue"),
    },
    {
      path: "/trigger",
      name: "trigger",
      component: () => import("../pages/WorkflowTrigger.vue"),
    },
  ],
});

export default router;
