import { useState } from "react";
import type { Contact } from "../../domain/types";
import { EmptyState, ListToolbar, Status } from "../AppViews";

function roleLabel(contact: Contact): string {
  if (contact.ordinaryCustomer) return "Cliente de mostrador";
  if (contact.role === "both") return "Cliente y proveedor";
  return contact.role === "supplier" ? "Proveedor" : "Cliente";
}

/** Clientes y proveedores: una lista para encontrar a alguien y escribirle o llamarle. */
export function ContactsPage({
  contacts,
  onAdd,
  onEdit,
  onDelete,
  canEdit,
  canDelete = false,
}: {
  contacts: Contact[];
  onAdd: () => void;
  onEdit: (contact: Contact) => void;
  onDelete: (contact: Contact) => void;
  canEdit: boolean;
  canDelete?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const term = search.trim().toLocaleLowerCase("es-CO");
  const visible = contacts
    .filter(
      (contact) =>
        [contact.name, contact.taxId, contact.email, contact.phone]
          .join(" ")
          .toLocaleLowerCase("es-CO")
          .includes(term) &&
        (roleFilter === "all" || contact.role === roleFilter || contact.role === "both"),
    )
    .sort((a, b) => a.name.localeCompare(b.name, "es-CO"));

  return (
    <div className="screen">
      <header className="screen-header">
        <h1>Clientes y proveedores</h1>
        {canEdit && (
          <div className="screen-actions">
            <button className="action-primary" type="button" onClick={onAdd}>
              Agregar contacto
            </button>
          </div>
        )}
      </header>

      <section aria-label="Tus contactos">
        <ListToolbar
          search={search}
          onSearch={setSearch}
          searchLabel="Buscar contactos"
          placeholder="Buscar por nombre, NIT, correo o teléfono"
          count={visible.length}
          countNoun={{ singular: "contacto", plural: "contactos" }}
          filter={roleFilter}
          onFilter={setRoleFilter}
          filterLabel="Mostrar"
          options={[
            { value: "all", label: "Todos" },
            { value: "customer", label: "Clientes" },
            { value: "supplier", label: "Proveedores" },
          ]}
        />
        {visible.length ? (
          <ul className="records records-contacts">
            <li className="records-head" aria-hidden="true">
              <span>Nombre</span>
              <span>Tipo</span>
              <span>Teléfono</span>
              <span>Correo</span>
              <span />
            </li>
            {visible.map((contact) => (
              <li key={contact.id}>
                <div className="records-main">
                  <strong>{contact.name}</strong>
                  <span>{contact.taxId || "Sin identificación"}</span>
                </div>
                <div data-label="Tipo">
                  <Status>{roleLabel(contact)}</Status>
                </div>
                <div data-label="Teléfono">
                  {contact.phone ? <a href={`tel:${contact.phone}`}>{contact.phone}</a> : "—"}
                </div>
                <div data-label="Correo" className="records-wrap">
                  {contact.email ? <a href={`mailto:${contact.email}`}>{contact.email}</a> : "—"}
                </div>
                {canEdit && (
                  <div className="row-actions">
                    <button className="action-link" type="button" onClick={() => onEdit(contact)}>
                      Editar
                    </button>
                    {canDelete && (
                      <button
                        className="action-link is-danger"
                        type="button"
                        onClick={() => onDelete(contact)}
                        aria-label={`Eliminar ${contact.name}`}
                      >
                        Eliminar
                      </button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState>
            {contacts.length
              ? "Ningún contacto coincide con esa búsqueda."
              : "Todavía no tienes contactos. Agrega un cliente o un proveedor para usarlo en tus ventas y compras."}
          </EmptyState>
        )}
      </section>
    </div>
  );
}
