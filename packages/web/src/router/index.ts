import { createRouter, createWebHistory } from "vue-router";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/",
      redirect: "/dashboard",
    },
    {
      path: "/dashboard",
      name: "dashboard",
      component: () => import("../pages/Dashboard.vue"),
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
    {
      path: "/:pathMatch(.*)*",
      name: "NotFound",
      component: () => import("../pages/NotFound.vue"),
    },
  ],
});

export default router;
