import { useEffect } from "react";
import { Link, useLocation } from "./router";
import { Footer, TopBar } from "./components/Brand";
import { Toasts } from "./components/ui";
import { PortalLayout } from "./portal";
import { Landing } from "./pages/Landing";
import { Register } from "./pages/Register";
import { Login } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";
import { ClubProfile } from "./pages/ClubProfile";
import { TeamEditor } from "./pages/TeamEditor";
import { PrintDocs } from "./pages/PrintDocs";

export function App() {
  const { path } = useLocation();

  useEffect(() => {
    const titles: Record<string, string> = {
      "/": "Inscripción ACB 2027 · Torneo #30",
      "/registro": "Registrar club · ACB 2027",
      "/entrar": "Entrar · Portal ACB 2027",
      "/portal": "Mis equipos · Portal ACB 2027",
      "/portal/club": "Perfil del club · Portal ACB 2027",
    };
    document.title = titles[path] || "Portal ACB 2027";
  }, [path]);

  let page;
  const teamPrint = /^\/portal\/equipo\/(\d+)\/imprimir$/.exec(path);
  const team = /^\/portal\/equipo\/(\d+)$/.exec(path);
  if (path === "/") page = <Landing />;
  else if (path === "/registro") page = <Register />;
  else if (path === "/entrar") page = <Login />;
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
