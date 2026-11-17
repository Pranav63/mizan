import socket
import subprocess
import sys

from scripts import dev


def test_second_launch_reuses_workspace_without_spawning(monkeypatch, capsys):
    monkeypatch.setattr(dev, "occupied", lambda port: True)
    monkeypatch.setattr(dev, "already_running", lambda: True)
    monkeypatch.setattr(subprocess, "Popen", lambda *a, **k: (_ for _ in ()).throw(AssertionError("Duplicate server")))
    assert dev.main() == 0
    assert "already running" in capsys.readouterr().out


def test_partial_port_collision_does_not_spawn_or_stop_processes(monkeypatch, capsys):
    monkeypatch.setattr(dev, "occupied", lambda port: port == 5178)
    monkeypatch.setattr(subprocess, "Popen", lambda *a, **k: (_ for _ in ()).throw(AssertionError("Port conflict")))
    monkeypatch.setattr(dev, "stop_children", lambda _: (_ for _ in ()).throw(AssertionError("Unrelated server")))
    assert dev.main() == 1
    assert "5178" in capsys.readouterr().err


def test_shutdown_releases_port_owned_by_descendant():
    # Reproduce npm owning a separate long-running Vite child.
    listener = "import socket,time; s=socket.socket(); s.bind(('127.0.0.1',0)); s.listen(); print(s.getsockname()[1],flush=True); time.sleep(60)"
    parent = "import subprocess,sys,time; child=subprocess.Popen([sys.executable,'-u','-c',sys.argv[1]],stdout=subprocess.PIPE,text=True); print(child.stdout.readline().strip(),flush=True); time.sleep(60)"
    child = subprocess.Popen([sys.executable, "-u", "-c", parent, listener],
                             stdout=subprocess.PIPE, text=True, start_new_session=True)
    try:
        port = int(child.stdout.readline())
        assert dev.occupied(port)
        dev.stop_children([child])
        # The descendant must release the listening port as well as its parent.
        with socket.socket() as check:
            check.settimeout(1)
            assert check.connect_ex(("127.0.0.1", port)) != 0
    finally:
        dev.stop_children([child])
        child.stdout.close()
