import { mount } from "svelte";
import App from "./App.svelte";
import "./styles/modernist.css";
import "./styles/app.css";

const target = document.getElementById("app");
if (!target) throw new Error("Missing app container");
mount(App, { target });
