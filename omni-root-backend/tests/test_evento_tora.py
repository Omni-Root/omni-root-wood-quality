"""
test_evento_tora.py — "uma tora física = um registro", provado sem câmera.

Exercita o RastreadorTora, o consolidar_defeitos e a detecção de presença
com análises SINTÉTICAS (dicionários no mesmo formato que analisar_frame
devolve) e com frames sintéticos de mesa vazia. Não precisa de modelo,
câmera nem banco -- roda em qualquer máquina em menos de um segundo.

USO (da raiz do repositório):
    python tests\\test_evento_tora.py          # relatório ✅/❌ no console
    python -m pytest tests\\test_evento_tora.py   # se tiver pytest instalado

Cada função test_* é um cenário que a demo pode encontrar. Se alguém mexer
nos parâmetros evento_* do Config ou na segmentação, isto é o que avisa
que "1 tora = 1 registro" deixou de valer.
"""

import os
import sys
import time
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))
os.chdir(RAIZ)  # main.py lê data/ e config.json relativos à raiz

import cv2  # noqa: E402
import numpy as np  # noqa: E402

import main as m  # noqa: E402

ROI = (0, 0, 640, 480)


# ------------------------------------------------------------
# Fábricas de análise sintética (mesmo formato de analisar_frame)
# ------------------------------------------------------------

def _quad(x, y, w, h):
    return np.array([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], dtype=np.int32).reshape(-1, 1, 2)


def analise(presente=True, vista="lateral", diam=20.0, defeitos=None, area_frac=0.30, segmentacao="cor"):
    """Uma análise de frame. `presente=False` = garra vazia."""
    if presente:
        lado = int((area_frac * 640 * 480) ** 0.5)
        contorno = _quad(50, 50, lado, lado)
    else:
        contorno, vista, segmentacao = None, "desconhecida", None
    lateral = vista == "lateral"
    ind = {
        "densidade": {"valor": 490.0, "unidade": "kg/m3", "metodo": "lookup_clone_X"},
        "altura": {"valor": 120.0 if lateral else 600.0, "unidade": "cm",
                   "metodo": "imagem_lateral_marcador_aruco" if lateral else "comprimento_tracamento_config"},
        "diametro": {"valor": diam, "unidade": "cm", "metodo": f"imagem_{vista}_marcador_aruco"},
        "tortuosidade": {"valor": 3.0 if lateral else 0.0, "unidade": "indice",
                         "metodo": "opencv_eixo_flecha" if lateral else "nao_aplicavel_secao"},
        "porcentagem_casca": {"valor": 12.0, "unidade": "%", "metodo": "opencv_otsu_casca_residual"},
        "volume_util": {"valor": 0.0, "unidade": "m3", "metodo": "cilindro_medido"},
        "massa_seca": {"valor": 0.0, "unidade": "kg", "metodo": "volume_x_densidade"},
        "apodrecimento_pragas": {"valor": 100.0, "unidade": "%", "metodo": "yolo_severidade"},
    }
    return {
        "status": "aprovado", "confianca_saude": 1.0,
        "defeitos": list(defeitos or []), "descartados": [],
        "indicadores": ind, "contorno": contorno, "roi": ROI,
        "vista": vista, "segmentacao": segmentacao, "marcador": None,
        "hud": ["a", "b", "c", "d"],
    }


def caixa(tipo, x=100, y=100, conf=0.9):
    return {"tipo_defeito": tipo, "pos_x": x, "pos_y": y, "largura": 40, "altura": 40,
            "area_relativa": 0.005, "confianca": conf}


def rodar(seq, cfg=None):
    """Passa a sequência pelo rastreador e devolve (rastreador, eventos gravados)."""
    r = m.RastreadorTora(cfg or m.Config())
    eventos = []
    for a in seq:
        e = r.processar(a)
        if e is not None:
            eventos.append(e)
    fim = r.finalizar()
    if fim is not None:
        eventos.append(fim)
    return r, eventos


PRESENTE, AUSENTE = analise(), analise(presente=False)


# ------------------------------------------------------------
# Ciclo de vida do evento
# ------------------------------------------------------------

def test_uma_tora_vira_um_registro():
    _, ev = rodar([PRESENTE] * 10 + [AUSENTE] * 6)
    assert len(ev) == 1, f"esperava 1 evento, veio {len(ev)}"
    assert ev[0].motivo_fechamento == "saiu_do_enquadramento"
    # abre no 3º frame de presença (os 2 primeiros são anti-flash) -> 8 acumulados
    assert ev[0].n_frames == 8


def test_duas_toras_viram_dois_registros_com_medidas_proprias():
    _, ev = rodar([analise(diam=20)] * 10 + [AUSENTE] * 6 + [analise(diam=30)] * 10 + [AUSENTE] * 6)
    assert len(ev) == 2
    assert ev[0].indicadores["diametro"]["valor"] == 20.0
    assert ev[1].indicadores["diametro"]["valor"] == 30.0


def test_passagem_rapida_nao_grava():
    """Mão/peça atravessando o frame em 2 análises: nem abre evento."""
    r, ev = rodar([PRESENTE] * 2 + [AUSENTE] * 10)
    assert ev == [] and r.total_descartados == 0


def test_evento_curto_e_descartado():
    """Abre (3 frames), mas fecha com menos que evento_min_frames_tora: descarta, não grava."""
    r, ev = rodar([PRESENTE] * 5 + [AUSENTE] * 6)   # abre no 3º -> só 3 frames acumulados (< 4)
    assert ev == [] and r.total_descartados == 1


def test_piscar_da_segmentacao_nao_quebra_a_tora():
    _, ev = rodar([PRESENTE] * 8 + [AUSENTE] * 3 + [PRESENTE] * 8 + [AUSENTE] * 6)
    assert len(ev) == 1


def test_ctrl_c_grava_a_tora_em_andamento():
    _, ev = rodar([PRESENTE] * 10)
    assert len(ev) == 1 and ev[0].motivo_fechamento == "encerramento"


def test_tempo_maximo_fecha_e_reabre_sem_perder_a_tora():
    cfg = m.Config()
    cfg.evento_duracao_maxima_seg = 0.05
    r = m.RastreadorTora(cfg)
    fechados = []
    for _ in range(12):
        e = r.processar(PRESENTE)
        if e is not None:
            fechados.append(e)
        time.sleep(0.01)
    assert len(fechados) >= 1
    assert all(e.motivo_fechamento == "tempo_maximo" for e in fechados)
    assert r.ativo, "depois do fechamento por tempo a tora continua lá: deve seguir ATIVO"


def test_duas_fotos_seguidas_sem_gap_fundem_e_com_gap_separam():
    """
    O cenário de `--fonte pasta/`: sem frame vazio entre as fotos, o rastreador
    não tem como saber que a tora mudou (e o registro sai misturado). É por
    isso que FonteImagens injeta um gap preto entre imagens.
    """
    _, sem_gap = rodar([analise(diam=20)] * 30 + [analise(diam=30)] * 30 + [AUSENTE] * 6)
    assert len(sem_gap) == 1, "sem gap é esperado fundir (documenta a limitação)"
    _, com_gap = rodar([analise(diam=20)] * 30 + [AUSENTE] * 10 + [analise(diam=30)] * 30 + [AUSENTE] * 6)
    assert len(com_gap) == 2
    assert [e.indicadores["diametro"]["valor"] for e in com_gap] == [20.0, 30.0]


# ------------------------------------------------------------
# Presença: cor x brilho, área mínima
# ------------------------------------------------------------

def test_contorno_por_brilho_nao_abre_evento():
    """Otsu de brilho acha 'algo' até em mesa vazia; sem cor, não é tora."""
    por_brilho = analise(segmentacao="brilho")
    r, ev = rodar([por_brilho] * 20 + [AUSENTE] * 6)
    assert ev == [] and r.total_eventos == 0


def test_contorno_por_brilho_abre_se_config_permitir():
    cfg = m.Config()
    cfg.evento_exige_cor = False
    _, ev = rodar([analise(segmentacao="brilho")] * 10 + [AUSENTE] * 6, cfg)
    assert len(ev) == 1


def test_contorno_pequeno_demais_nao_e_tora():
    pequeno = analise(area_frac=0.05)  # abaixo de evento_area_minima_tora (0.10)
    _, ev = rodar([pequeno] * 20 + [AUSENTE] * 6)
    assert ev == []


def _mesa(base, ruido=5, seed=0):
    rng = np.random.default_rng(seed)
    f = np.clip(base.astype(np.float32) + rng.normal(0, ruido, base.shape), 0, 255).astype(np.uint8)
    return f


def _presenca_no_frame(frame) -> bool:
    """Passa um frame real pela segmentação e pelo critério de presença do rastreador."""
    mask, contorno, origem = m.segmentar_tora_com_origem(frame)
    vista, *_ = m.classificar_vista(contorno)
    a = {"vista": vista, "contorno": contorno, "segmentacao": origem,
         "roi": (0, 0, frame.shape[1], frame.shape[0])}
    return m.RastreadorTora(m.Config())._tem_tora(a)


def test_mesa_vazia_com_gradiente_de_luz_nao_e_tora():
    h, w = 480, 640
    g = np.tile(np.linspace(90, 170, w, dtype=np.uint8), (h, 1))
    assert not _presenca_no_frame(_mesa(cv2.merge([g, g, g]), ruido=4))


def test_mesa_branca_com_sombra_no_centro_nao_e_tora():
    h, w = 480, 640
    f = np.full((h, w, 3), 215, np.uint8)
    cv2.circle(f, (w // 2, h // 2), 120, (170, 170, 170), -1)
    assert not _presenca_no_frame(cv2.GaussianBlur(f, (51, 51), 0))


def test_frame_preto_do_gap_nao_e_tora():
    assert not _presenca_no_frame(np.zeros((480, 640, 3), np.uint8))


def _bgr(h, s, v):
    return tuple(int(x) for x in cv2.cvtColor(np.uint8([[[h, s, v]]]), cv2.COLOR_HSV2BGR)[0, 0])


def _area_segmentada(frame) -> float:
    _, contorno, _ = m.segmentar_tora_com_origem(frame)
    return 0.0 if contorno is None else cv2.contourArea(contorno) / (frame.shape[0] * frame.shape[1])


def test_rodela_palida_com_mao_no_frame_nao_abraca_a_parede():
    """
    Captura real da demo: rodela lixada (S~44) segurada pela mão (S~135)
    contra parede branca. A mão vira o grupo "saturado" e a madeira cai no
    grupo "sem cor" -- que antes incluía a parede inteira (68% do frame).
    """
    h, w = 480, 640
    f = np.full((h, w, 3), 192, np.uint8)                       # parede branca
    cv2.circle(f, (w // 2, h // 2), 120, _bgr(21, 44, 164), -1)  # rodela pálida
    cv2.rectangle(f, (w // 2 + 60, h // 2), (w, h), _bgr(6, 135, 72), -1)  # mão
    area = _area_segmentada(_mesa(f))
    # A mão que encosta na rodela entra junto (mesmo matiz: limitação
    # conhecida); o que NÃO pode é a parede entrar (antes: 0.79 do frame).
    assert 0.10 <= area <= 0.30, f"área segmentada {area:.2f} (rodela ~0.15 + mão encostada)"


def test_rodela_fora_do_centro_e_segmentada():
    """
    Captura real da demo: rodela segurada no canto superior esquerdo. A
    segmentação antiga decidia o grupo de cor pelo pixel CENTRAL do frame
    (que caía na mesa/mão) e traçava tudo menos a madeira.
    """
    h, w = 480, 640
    for fundo in (15, 128, 192):
        f = np.full((h, w, 3), fundo, np.uint8)
        cv2.circle(f, (150, 120), 100, _bgr(21, 44, 164), -1)  # ~0.10 do frame, no canto
        area = _area_segmentada(_mesa(f))
        assert 0.08 <= area <= 0.13, f"fundo {fundo}: área {area:.2f}"


def test_rodela_palida_sobre_fundos_neutros():
    h, w = 480, 640
    for fundo in (15, 128, 192):  # preto, cinza, branco
        f = np.full((h, w, 3), fundo, np.uint8)
        cv2.circle(f, (w // 2, h // 2), 120, _bgr(21, 44, 164), -1)
        area = _area_segmentada(_mesa(f))
        assert 0.12 <= area <= 0.18, f"fundo {fundo}: área {area:.2f}"


def test_tora_creme_sobre_mesa_cinza_e_tora():
    h, w = 480, 640
    f = np.full((h, w, 3), 128, np.uint8)
    cv2.ellipse(f, (w // 2, h // 2), (250, 80), 0, 0, 360, (140, 200, 230), -1)  # BGR creme
    assert _presenca_no_frame(_mesa(f))


def test_fonte_imagens_emite_gap_preto_entre_fotos(tmp_path=None):
    import tempfile
    pasta = Path(tmp_path) if tmp_path else Path(tempfile.mkdtemp())
    for i, cor in enumerate([(140, 200, 230), (60, 120, 200)]):
        img = np.full((120, 160, 3), 128, np.uint8)
        cv2.circle(img, (80, 60), 40, cor, -1)
        cv2.imwrite(str(pasta / f"tora_{i}.png"), img)
    fonte = m.FonteImagens(pasta, segundos_por_imagem=0.08, segundos_de_gap=0.08)
    vistos = []
    t0 = time.monotonic()
    while time.monotonic() - t0 < 0.40:
        ok, frame = fonte.read()
        assert ok and frame is not None and frame.shape == (120, 160, 3)
        vistos.append("preto" if int(frame.max()) == 0 else "foto")
    assert "preto" in vistos and "foto" in vistos, vistos
    # alterna: nunca dois blocos de foto sem um preto no meio
    blocos = [v for i, v in enumerate(vistos) if i == 0 or v != vistos[i - 1]]
    assert all(blocos[i] != blocos[i + 1] for i in range(len(blocos) - 1)), blocos


# ------------------------------------------------------------
# Consolidação de indicadores e defeitos
# ------------------------------------------------------------

def test_mediana_ignora_frame_ruim():
    _, ev = rodar([analise(diam=20)] * 9 + [analise(diam=200)] + [AUSENTE] * 6)
    assert ev[0].indicadores["diametro"]["valor"] == 20.0


def test_tortuosidade_so_agrega_frames_laterais():
    seq = [analise(vista="lateral")] * 6 + [analise(vista="secao")] * 6 + [AUSENTE] * 6
    _, ev = rodar(seq)
    assert ev[0].indicadores["tortuosidade"]["valor"] == 3.0  # e não diluída pelos zeros da seção
    assert ev[0].indicadores["altura"]["valor"] == 120.0      # comprimento medido vale mais que o do config


def test_defeito_persistente_fica_e_ruido_de_um_frame_cai():
    frames = [[caixa("Live_Knot")] for _ in range(10)]
    frames[3].append(caixa("resin", x=300, y=300, conf=0.8))
    mantidos, descartados = m.consolidar_defeitos(frames, fracao_minima=0.25)
    assert [d["tipo_defeito"] for d in mantidos] == ["Live_Knot"]
    assert [d["tipo_defeito"] for d in descartados] == ["resin"]
    assert mantidos[0]["frames"] == 10 and mantidos[0]["fracao_frames"] == 1.0


def test_no_que_anda_no_frame_conta_uma_vez():
    frames = [[caixa("Live_Knot", x=100 + 60 * i)] for i in range(10)]  # caixas sem sobreposição
    mantidos, _ = m.consolidar_defeitos(frames, fracao_minima=0.25)
    assert len(mantidos) == 1


def test_dois_nos_distintos_contam_dois():
    frames = [[caixa("Live_Knot", x=100), caixa("Live_Knot", x=400)] for _ in range(10)]
    mantidos, _ = m.consolidar_defeitos(frames, fracao_minima=0.25)
    assert len(mantidos) == 2


def test_status_sai_dos_defeitos_consolidados():
    """Um nó morto persistente em 100% dos frames reprova a tora inteira."""
    grave = [caixa("Dead_Knot", conf=0.9)]
    _, ev = rodar([analise(defeitos=grave)] * 10 + [AUSENTE] * 6)
    assert ev[0].status == "reprovado"


def test_metodo_medicao_cabe_no_varchar_50_do_postgres():
    _, ev = rodar([PRESENTE] * 10 + [AUSENTE] * 6)
    assert all(len(v["metodo"]) <= 50 for v in ev[0].indicadores.values())


# ------------------------------------------------------------
# Runner sem pytest
# ------------------------------------------------------------

if __name__ == "__main__":
    testes = [(n, f) for n, f in sorted(globals().items()) if n.startswith("test_") and callable(f)]
    falhas = 0
    for nome, fn in testes:
        try:
            fn()
            print(f"✅ {nome}")
        except AssertionError as e:
            falhas += 1
            print(f"❌ {nome}: {e}")
        except Exception as e:  # noqa: BLE001
            falhas += 1
            print(f"💥 {nome}: {type(e).__name__}: {e}")
    print(f"\n{len(testes) - falhas}/{len(testes)} cenários OK" + (f" — {falhas} FALHA(S)" if falhas else ""))
    sys.exit(1 if falhas else 0)
