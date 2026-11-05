import { useEffect } from "react";
import { Link, navigate, useLocation } from "./router";
import { Footer, TopBar } from "./components/Brand";
import { Toasts } from "./components/ui";
import { PortalLayout } from "./portal";
import { Landing } from "./pages/Landing";
import { MyClub } from "./pages/MyClub";
import { Dashboard } from "./pages/Dashboard";
import { ClubProfile } from "./pages/ClubProfile";
import { TeamEditor } from "./pages/TeamEditor";
import { PrintDocs } from "./pages/PrintDocs";

export function App() {
  const { path, search } = useLocation();
  const legacy = path === "/registro" || path === "/entrar";

  // Old links (emails, printed flyers, the Odoo site) land on the unified page.
  useEffect(() => {
    if (!legacy) return;
    const params = new URLSearchParams(search);
    if (path === "/registro" && !params.has("email")) params.set("solicitar", "1");
    const qs = params.toString();
    navigate(`/mi-club${qs ? `?${qs}` : ""}`, { replace: true });
  }, [legacy, path, search]);

  useEffect(() => {
    const titles: Record<string, string> = {
      "/": "Inscripción ACB 2027 · Torneo #30",
      "/mi-club": "Mi club · Portal ACB 2027",
      "/portal": "Mis equipos · Portal ACB 2027",
      "/portal/club": "Perfil del club · Portal ACB 2027",
    };
    document.title = titles[path] || "Portal ACB 2027";
  }, [path]);

  let page;
  const teamPrint = /^\/portal\/equipo\/(\d+)\/imprimir$/.exec(path);
  const team = /^\/portal\/equipo\/(\d+)$/.exec(path);
  if (path === "/") page = <Landing />;
  else if (path === "/mi-club") page = <MyClub />;
  else if (legacy) page = null;
  else if (path === "/portal") page = <PortalLayout><Dashboard /></PortalLayout>;
  else if (path === "/portal/club") page = <PortalLayout><ClubProfile /></PortalLayout>;
  else if (teamPrint) page = <PrintDocs id={Number(teamPrint[1])} />;
  else if (team) page = <PortalLayout><TeamEditor id={Number(team[1])} /></PortalLayout>;
  else
    page = (
      <>
        <TopBar />
        <div className="center-load">
          <div style={{ textAlign: "center" }}>
            <div className="display">Página no encontrada</div>
            <p className="lead">
              <Link to="/">Volver al inicio</Link>
            </p>
          </div>
        </div>
        <Footer />
      </>
    );

  return (
    <>
      {page}
      <Toasts />
    </>
  );
}
