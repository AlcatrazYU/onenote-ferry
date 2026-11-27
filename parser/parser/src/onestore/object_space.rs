use super::object::Object;
use crate::shared::exguid::ExGuid;
use std::rc::Rc;

pub trait ObjectSpace: std::fmt::Debug {
    fn get_object(&self, id: ExGuid) -> Option<Rc<Object>>;
    fn content_root(&self) -> Option<ExGuid>;
    fn metadata_root(&self) -> Option<ExGuid>;

    /// OneNote Ferry patch: the metadata root object as each revision of the history had it (the
    /// revisions other than the current one and those it builds on). Empty where there is none.
    fn history_metadata(&self) -> Vec<Rc<Object>> {
        Vec::new()
    }
}

pub type ObjectSpaceRef = Rc<dyn ObjectSpace>;
