from pydantic import BaseModel, Field, EmailStr
from typing import Optional, List, Dict, Any

class UserLogin(BaseModel):
    username: str
    password: str

class UserOut(BaseModel):
    id: str
    username: str
    full_name: str
    email: Optional[str] = None
    role: str
    ativo: bool
    is_active: bool = True

    def model_post_init(self, __context: Any) -> None:
        self.is_active = self.ativo

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut

class UserCreate(BaseModel):
    username: str
    password: str
    full_name: str
    email: Optional[str] = None
    role: str = "CADASTRADOR"  # ADMIN, GESTOR_NAC, CADASTRADOR, GERENCIAL, SERVIDOR
    ativo: bool = True
    is_active: Optional[bool] = None

    def model_post_init(self, __context: Any) -> None:
        if self.is_active is not None:
            self.ativo = self.is_active

class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    email: Optional[str] = None
    role: Optional[str] = None
    ativo: Optional[bool] = None
    is_active: Optional[bool] = None

    def model_post_init(self, __context: Any) -> None:
        if self.is_active is not None and self.ativo is None:
            self.ativo = self.is_active

class UserPasswordReset(BaseModel):
    nova_senha: Optional[str] = None
    new_password: Optional[str] = None

    def get_password(self) -> str:
        return self.nova_senha or self.new_password or ""


class ServidorBase(BaseModel):
    matricula: str
    nome_completo: str
    nome_guerra: Optional[str] = None
    cargo_sigla: str  # DPF, EPF, APF, PPF, PCF, ADM
    unidade_sigla: str  # SR/PF/DF, DPF/CAS/PR, etc.
    login_rede: Optional[str] = None
    email_institucional: str
    telefone_celular: Optional[str] = None
    tpe: bool = False
    is_missionario_geral: bool = True
    observacoes_gerais: Optional[str] = None
    ativo: bool = True

class ServidorCreate(ServidorBase):
    pass

class ServidorUpdate(BaseModel):
    nome_completo: Optional[str] = None
    nome_guerra: Optional[str] = None
    cargo_sigla: Optional[str] = None
    unidade_sigla: Optional[str] = None
    login_rede: Optional[str] = None
    email_institucional: Optional[str] = None
    telefone_celular: Optional[str] = None
    tpe: Optional[bool] = None
    is_missionario_geral: Optional[bool] = None
    observacoes_gerais: Optional[str] = None
    ativo: Optional[bool] = None

class ServidorOut(ServidorBase):
    id: str
    created_at: Optional[str] = None
    updated_at: Optional[str] = None

class ParticipanteBase(BaseModel):
    servidor_matricula: str
    papel: str
    meio_transporte: str = "AEREO"  # AEREO, VIATURA_OFICIAL, FLUVIAL, MISTO, OUTRO
    data_apresentacao: str
    data_retorno: str
    is_missao_sede: bool = False
    valor_diaria_unitaria: float = Field(default=425.00, ge=0.0)
    valor_passagem_aerea: float = Field(default=0.0, ge=0.0)
    outros_custos: float = Field(default=0.0, ge=0.0)
    localizador_aereo: Optional[str] = None
    numero_eticket: Optional[str] = None
    observacoes: Optional[str] = None

class ParticipanteCreate(ParticipanteBase):
    pass

class ParticipanteUpdate(BaseModel):
    papel: Optional[str] = None
    meio_transporte: Optional[str] = None
    data_apresentacao: Optional[str] = None
    data_retorno: Optional[str] = None
    is_missao_sede: Optional[bool] = None
    valor_diaria_unitaria: Optional[float] = Field(default=None, ge=0.0)
    valor_passagem_aerea: Optional[float] = Field(default=None, ge=0.0)
    outros_custos: Optional[float] = Field(default=None, ge=0.0)
    localizador_aereo: Optional[str] = None
    numero_eticket: Optional[str] = None
    observacoes: Optional[str] = None

class ParticipanteOut(ParticipanteBase):
    id: str
    missao_id: str
    servidor_nome: Optional[str] = None
    servidor_cargo: Optional[str] = None
    servidor_lotacao: Optional[str] = None
    dias_participacao: int
    qtd_diarias: float
    valor_total_diarias: float
    custo_total_servidor: float
    created_at: Optional[str] = None
    updated_at: Optional[str] = None

class MissaoBase(BaseModel):
    codigo_missao: str
    titulo: str
    justificativa: str
    tipo_missao: str  # Operacional, Capacitação, etc.
    unidade_solicitante: str
    unidade_destino: Optional[str] = None
    setor_destino: Optional[str] = None
    localidade_descricao: str
    data_inicio: str
    data_termino: str
    responsavel_matricula: Optional[str] = None
    missionario_matricula: Optional[str] = None
    modalidade: str = "INDIVIDUAL"  # 'INDIVIDUAL' como padrão
    status_atual: str = "RASCUNHO"
    meio_transporte: str = "AEREO"  # AEREO, TERRESTRE, PROPRIO
    custo_estimado_passagens: float = Field(default=0.0, ge=0.0)
    numero_sat: Optional[str] = None
    numero_om: Optional[str] = None
    numero_pcdp: Optional[str] = None
    processo_sei: Optional[str] = None
    valor_diaria_padrao: float = Field(default=425.00, ge=0.0)  # CAMPO EDITÁVEL DA DIÁRIA NA MISSÃO
    observacoes: Optional[str] = None

class MissaoCreate(MissaoBase):
    servidores_matriculas: Optional[List[str]] = None

class MissaoUpdate(BaseModel):
    titulo: Optional[str] = None
    justificativa: Optional[str] = None
    tipo_missao: Optional[str] = None
    unidade_solicitante: Optional[str] = None
    unidade_destino: Optional[str] = None
    setor_destino: Optional[str] = None
    localidade_descricao: Optional[str] = None
    data_inicio: Optional[str] = None
    data_termino: Optional[str] = None
    responsavel_matricula: Optional[str] = None
    missionario_matricula: Optional[str] = None
    modalidade: Optional[str] = None
    status_atual: Optional[str] = None
    meio_transporte: Optional[str] = None
    custo_estimado_passagens: Optional[float] = Field(default=None, ge=0.0)
    numero_sat: Optional[str] = None
    numero_om: Optional[str] = None
    numero_pcdp: Optional[str] = None
    processo_sei: Optional[str] = None
    valor_diaria_padrao: Optional[float] = Field(default=None, ge=0.0)
    observacoes: Optional[str] = None

class StatusUpdate(BaseModel):
    novo_status: str
    justificativa: Optional[str] = None

class ValorDiariaUpdate(BaseModel):
    novo_valor_diaria: float = Field(ge=0.0, description="Novo valor base da diária em R$")
    recalcular_participantes: bool = Field(default=True, description="Se deve atualizar e recalcular todos os participantes vinculados")

class ValorDiariaItem(BaseModel):
    id: str
    categoria: str
    descricao: str
    valor: float
    ativo: bool = True
    created_at: Optional[str] = None

class ValorDiariaItemUpdate(BaseModel):
    valor: float = Field(ge=0.0)
    descricao: Optional[str] = None
    ativo: Optional[bool] = None

class SetorDestinoOut(BaseModel):
    id: str
    sigla: str
    nome: str
    unidade_pai_sigla: str = "SR/PF/PB"
    ativo: bool = True
    created_at: Optional[str] = None

class SetorDestinoCreate(BaseModel):
    sigla: str
    nome: str
    unidade_pai_sigla: str = "SR/PF/PB"

class MissaoOut(MissaoBase):
    id: str
    total_dias: int
    responsavel_nome: Optional[str] = None
    missionario_nome: Optional[str] = None
    total_participantes: int = 0
    total_custo_diarias: float = 0.0
    total_custo_passagens: float = 0.0
    total_custo_geral: float = 0.0
    participantes: List[ParticipanteOut] = []
    created_at: Optional[str] = None
    updated_at: Optional[str] = None

class OrgaoUnidadeBase(BaseModel):
    sigla: str
    nome_extenso: str
    municipio: str
    uf: str
    is_fronteira: bool = False
    valor_diaria: float = Field(default=380.00, ge=0.0)
    categoria_diaria: str = "CAPITAIS"
    tipo_unidade: str = "CAPITAL"
    ativo: bool = True

class OrgaoUnidadeCreate(OrgaoUnidadeBase):
    pass

class OrgaoUnidadeUpdate(BaseModel):
    nome_extenso: Optional[str] = None
    municipio: Optional[str] = None
    uf: Optional[str] = None
    is_fronteira: Optional[bool] = None
    valor_diaria: Optional[float] = Field(default=None, ge=0.0)
    categoria_diaria: Optional[str] = None
    tipo_unidade: Optional[str] = None
    ativo: Optional[bool] = None

class OrgaoUnidadeOut(OrgaoUnidadeBase):
    id: str
    created_at: Optional[str] = None


class ConfigItem(BaseModel):
    chave: str
    valor: str
    descricao: Optional[str] = None

class ConfigUpdate(BaseModel):
    valor: str
    descricao: Optional[str] = None

class AlertItem(BaseModel):
    tipo: str  # PERIGO, ALERTA, INFO
    titulo: str
    mensagem: str
    missao_codigo: Optional[str] = None
    missao_id: Optional[str] = None
    servidor_matricula: Optional[str] = None

class DashboardSummary(BaseModel):
    total_missoes: int
    missoes_em_andamento: int
    missoes_planejamento: int
    missoes_concluidas: int
    total_servidores_ativos: int
    total_servidores_em_missao: int
    custo_total_diarias: float
    custo_total_passagens: float
    custo_total_geral: float
    valor_diaria_padrao_sistema: float
    alertas: List[AlertItem]
    # Novos indicadores solicitados
    diarias_sr_pb: float = 0.0
    diarias_cge_pb: float = 0.0
    diarias_pat_pb: float = 0.0
    passagens_total_pb: float = 0.0
    servidores_cadastrar_scdp: int = 0
    servidores_prestacao_contas_pendente: int = 0
    servidores_om_pendente: int = 0
    servidores_missao_concluida: int = 0
